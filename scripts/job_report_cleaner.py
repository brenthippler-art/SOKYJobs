"""
job_report_cleaner.py
---------------------
Takes the South Central KY "Open Job Report" (a JobsEQ export) and produces a
clean, sortable workbook:

  * Open Jobs     - recent, de-duplicated postings with clean City / County /
                    Category / Pay columns and Excel filter dropdowns
  * Likely Filled - postings that are probably ghost jobs, with the reason
  * Summary       - job counts by county and category
  * How To Use    - plain-English notes for whoever opens the file

Usage:
    python job_report_cleaner.py "South_Central_Open_Job_Report_10-19-2026.xlsx"
    python job_report_cleaner.py report.xlsx --max-age 60 -o cleaned.xlsx

Requires:  pip install pandas openpyxl
"""

import argparse
import hashlib
import json
import math
import re
from datetime import datetime
from pathlib import Path

import pandas as pd
from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.table import Table, TableStyleInfo

# =============================================================================
# 1. SETTINGS - the knobs you're most likely to want to change
# =============================================================================

FRESH_DAYS = 30        # posted within this many days  -> "New"
AGING_DAYS = 60        # posted within this many days  -> "Recent", else "Aging"
DEFAULT_MAX_AGE = 90   # older than this -> moved to "Likely Filled"

# Every town that shows up in the report, mapped to its county.
# The parser searches the raw location text for these names, so street
# addresses, store names, and "Bowling Green, KY 42101" all resolve the same.
CITY_TO_COUNTY = {
    "Bowling Green": "Warren", "Smiths Grove": "Warren", "Woodburn": "Warren",
    "Alvaton": "Warren", "Rockfield": "Warren", "Oakland": "Warren",
    "Hadley": "Warren", "Drake": "Warren", "Plano": "Warren",
    "Glasgow": "Barren", "Cave City": "Barren", "Park City": "Barren",
    "Hiseville": "Barren", "Eighty Eight": "Barren", "Knob Lick": "Barren",
    "Austin": "Barren", "Lucas": "Barren",
    "Franklin": "Simpson",
    "Russellville": "Logan", "Auburn": "Logan", "Adairville": "Logan",
    "Lewisburg": "Logan", "Olmstead": "Logan", "South Union": "Logan",
    "Leitchfield": "Grayson", "Caneyville": "Grayson", "Clarkson": "Grayson",
    "Scottsville": "Allen", "Adolphus": "Allen",
    "Columbia": "Adair", "Breeding": "Adair",
    "Beaver Dam": "Ohio", "Cromwell": "Ohio", "Hartford": "Ohio",
    "Morgantown": "Butler", "Rochester": "Butler", "Woodbury": "Butler",
    "Horse Cave": "Hart", "Munfordville": "Hart", "Bonnieville": "Hart",
    "Cub Run": "Hart", "Canmer": "Hart", "Hardyville": "Hart",
    "Edmonton": "Metcalfe", "Center": "Metcalfe", "Beaumont": "Metcalfe",
    "Tompkinsville": "Monroe", "Gamaliel": "Monroe", "Fountain Run": "Monroe",
    "Mount Hermon": "Monroe",
    "Brownsville": "Edmonson", "Bee Spring": "Edmonson",
    "Mammoth Cave": "Edmonson", "Sweeden": "Edmonson",
    "Allensville": "Todd",
    "Upton": "Hardin", "Magnolia": "Larue",
    "Dunmor": "Muhlenberg", "Owensboro": "Daviess", "Belmont": "Bullitt",
}

# Misspellings seen in the data -> correct name
CITY_TYPOS = {"Glasglow": "Glasgow"}

# Exact location strings that need a hand-picked answer: (city, county)
LOCATION_OVERRIDES = {
    "Kentucky Exposition Center": ("Louisville", "Jefferson"),
}

# Rough town-center coordinates, used only when a posting gives GPS
# coordinates instead of an address (we snap to the nearest town).
CITY_COORDS = {
    "Bowling Green": (36.990, -86.444), "Glasgow": (36.996, -85.912),
    "Franklin": (36.722, -86.577), "Russellville": (36.845, -86.887),
    "Scottsville": (36.753, -86.190), "Smiths Grove": (37.052, -86.208),
    "Leitchfield": (37.480, -86.294), "Columbia": (37.103, -85.306),
    "Morgantown": (37.226, -86.684), "Brownsville": (37.193, -86.267),
    "Horse Cave": (37.180, -85.907), "Edmonton": (36.980, -85.612),
    "Tompkinsville": (36.702, -85.692), "Beaver Dam": (37.402, -86.876),
}

# Employers that are staffing / travel agencies. These are LABELED, not
# removed: travel-nurse agencies repost constantly, but local temp agencies
# are often a good door for people re-entering the workforce.
AGENCY_PATTERN = re.compile(
    r"staffing|med ?staff|staff ?dna|perm staff|personnel|recruit|workforce"
    r"|employment professionals|travelers|vibra travels|aya healthcare"
    r"|amn healthcare|cynet|anders group|cross country|trusted health"
    r"|vivian health|aerotek|^kelly$|adecco|manpower|spherion|vytalent|proman",
    re.IGNORECASE,
)

# The first two digits of a SOC code identify one of 22 federal job families.
# We use friendlier names than the official ones.
SOC_CATEGORIES = {
    "11": "Management", "13": "Business & Finance", "15": "Computer & IT",
    "17": "Engineering", "19": "Science", "21": "Social Services & Counseling",
    "23": "Legal", "25": "Education", "27": "Arts, Media & Design",
    "29": "Healthcare (Licensed)", "31": "Healthcare Support",
    "33": "Security & Protective", "35": "Food Service",
    "37": "Cleaning & Grounds", "39": "Personal Care & Service",
    "41": "Sales & Retail", "43": "Office & Admin",
    "45": "Farming & Forestry", "47": "Construction",
    "49": "Maintenance & Repair", "51": "Production & Manufacturing",
    "53": "Driving & Warehouse",
}

# A few specific occupations whose official family is misleading.
# Key = full SOC code from the report.
SOC_OVERRIDES = {
    "27-1026.00": "Sales & Retail",   # Merchandise Displayers (store merchandisers)
}


# =============================================================================
# 2. LOADING - find the real header row and drop the junk around the data
# =============================================================================

def load_report(path):
    """Read the JobsEQ sheet. Returns (dataframe, report_date)."""
    raw = pd.read_excel(path, header=None)

    # The header isn't on row 1 (row 1 is a title), so look for it.
    header_row = raw.index[raw.iloc[:, 0].astype(str).str.strip() == "Job Title"][0]
    df = pd.read_excel(path, header=header_row)

    # Footer rows ("Source: JobsEQ", "Exported on...") have no URL - drop them.
    df = df.dropna(subset=["Url"]).copy()

    # The title row says "...active as of 10/19/2026". Use that as "today" so
    # posting ages are measured from when the report was made, not when you
    # happen to run the script.
    title = str(raw.iloc[0, 0])
    match = re.search(r"(\d{1,2})/(\d{1,2})/(\d{4})", title)
    if match:
        m, d, y = (int(x) for x in match.groups())
        report_date = datetime(y, m, d)
    else:
        report_date = df["Start"].max()

    return df, pd.Timestamp(report_date)


# =============================================================================
# 3. CLEANING HELPERS - one small function per messy column
# =============================================================================

def fix_text(text):
    """Repair broken characters, e.g. 'Registered Nurse â Emergency Room'."""
    if not isinstance(text, str):
        return text
    text = text.replace("â\u0080\u0093", "–").replace(" â ", " – ")
    return re.sub(r"\s+", " ", text).strip()


# Short words that should stay capitalized after we fix ALL-CAPS titles
ACRONYMS = {"RN", "LPN", "CNA", "CMA", "CDL", "PRN", "ICU", "ER", "OR", "PT", "OT",
            "HR", "IT", "KY", "US", "II", "III", "IV", "CNC", "DC", "EMT", "STNA",
            "ASL", "MRI", "CT", "LCSW", "APRN", "NP", "PA", "OTR", "AM", "PM", "WKU"}


def tidy_title(title):
    """'CREW MEMBER - CDL A' -> 'Crew Member - CDL A'. Mixed-case titles are left alone."""
    title = fix_text(title)
    if not isinstance(title, str):
        return title
    letters = [c for c in title if c.isalpha()]
    if not letters or sum(c.isupper() for c in letters) / len(letters) < 0.7:
        return title
    words = []
    for word in title.split(" "):
        core = re.sub(r"[^A-Za-z]", "", word)
        words.append(word if core.upper() in ACRONYMS else word.capitalize())
    return " ".join(words)


def nearest_city(lat, lon):
    """Snap a GPS point to the closest town in CITY_COORDS."""
    def distance(city):
        clat, clon = CITY_COORDS[city]
        return math.hypot(lat - clat, (lon - clon) * math.cos(math.radians(lat)))
    return min(CITY_COORDS, key=distance)


# Longest names first, so "Mammoth Cave" wins over a shorter overlapping name
_CITY_NAMES = sorted(list(CITY_TO_COUNTY) + list(CITY_TYPOS), key=len, reverse=True)
_CITY_REGEX = re.compile(r"\b(" + "|".join(re.escape(c) for c in _CITY_NAMES) + r")\b",
                         re.IGNORECASE)


def parse_location(raw, zip_lookup):
    """Turn any of the ~650 location spellings into (city, county, zip)."""
    text = str(raw).strip()

    zip_match = re.search(r"\b(4[0-2]\d{3})(?:-\d{4})?\b", text)  # KY ZIPs: 40000-42799
    zip_code = zip_match.group(1) if zip_match else ""

    # a) one-off locations that don't follow any pattern
    if text in LOCATION_OVERRIDES:
        return (*LOCATION_OVERRIDES[text], zip_code)

    # b) a known town name appears in the text. Take the LAST one, because
    #    street names are often town names too: in
    #    "3075 Scottsville Road, Bowling Green, KY" the town is Bowling Green.
    matches = list(_CITY_REGEX.finditer(text))
    if matches:
        city = matches[-1].group(1).title()
        city = CITY_TYPOS.get(city, city)
        return city, CITY_TO_COUNTY[city], zip_code

    # c) "Hart County, Kentucky" - county known, town not
    county_match = re.search(r"(\w+) County", text, re.IGNORECASE)
    if county_match:
        return "(County-wide)", county_match.group(1).title(), zip_code

    # d) just a ZIP code - borrow the town from another row with that ZIP
    if zip_code in zip_lookup:
        city = zip_lookup[zip_code]
        return city, CITY_TO_COUNTY[city], zip_code

    # e) GPS coordinates like "36.99751, -86.42483"
    coords = re.fullmatch(r"(-?\d+\.\d+),\s*(-?\d+\.\d+)", text)
    if coords:
        city = nearest_city(float(coords.group(1)), float(coords.group(2)))
        return city, CITY_TO_COUNTY[city], zip_code

    return "Unknown", "Unknown", zip_code


def build_zip_lookup(locations):
    """Learn ZIP -> town from rows that list both (e.g. 'Franklin, KY 42134')."""
    pairs = {}
    for text in locations.astype(str):
        city_matches = list(_CITY_REGEX.finditer(text))
        zip_match = re.search(r"\b(4[0-2]\d{3})\b", text)
        if city_matches and zip_match:
            name = city_matches[-1].group(1).title()
            city = CITY_TYPOS.get(name, name)
            pairs.setdefault(zip_match.group(1), {}).setdefault(city, 0)
            pairs[zip_match.group(1)][city] += 1
    # if a ZIP appears with several towns, take the most common one
    return {z: max(cities, key=cities.get) for z, cities in pairs.items()}


def pay_band(hourly):
    if pd.isna(hourly):
        return "Not listed"
    if hourly < 15:
        return "Under $15/hr"
    if hourly < 20:
        return "$15-20/hr"
    if hourly < 25:
        return "$20-25/hr"
    if hourly < 35:
        return "$25-35/hr"
    return "$35+/hr"


def title_key(title):
    """Normalize a title for duplicate matching: 'CREW MEMBER *' == 'Crew Member'."""
    return re.sub(r"[^a-z0-9]+", " ", str(title).lower()).strip()


# =============================================================================
# 4. THE PIPELINE - clean every column, then decide what's a ghost job
# =============================================================================

def clean(df, report_date, max_age):
    out = pd.DataFrame()

    out["Job Title"] = df["Job Title"].map(tidy_title)
    out["Employer"] = df["Employer"].map(fix_text)

    zip_lookup = build_zip_lookup(df["Reported Location"])
    parsed = df["Reported Location"].apply(lambda x: parse_location(x, zip_lookup))
    out["City"] = parsed.str[0]
    out["County"] = parsed.str[1]
    out["ZIP"] = parsed.str[2]

    soc = df["SOC"].astype(str)
    out["Category"] = soc.map(SOC_OVERRIDES).fillna(
        soc.str[:2].map(SOC_CATEGORIES)).fillna("Other")
    out["Occupation"] = df["Occupation Name"]

    # Wage is annual; 0 means the posting didn't say.
    annual = df["Wage"].where(df["Wage"] > 0)
    out["Annual Pay"] = annual
    out["Est. Hourly"] = (annual / 2080).round(2)   # 2080 = 40 hrs x 52 weeks
    out["Pay Range"] = out["Est. Hourly"].map(pay_band)

    out["Agency?"] = df["Employer"].astype(str).str.contains(AGENCY_PATTERN).map(
        {True: "Staffing/Travel agency", False: ""})

    out["Posted"] = df["Start"]
    out["Days Old"] = (report_date - df["Start"]).dt.days
    out["Freshness"] = pd.cut(out["Days Old"], [-1, FRESH_DAYS, AGING_DAYS, 10**6],
                              labels=["New", "Recent", "Aging"]).astype(str)
    out["Link"] = df["Url"]
    out["Original Location"] = df["Reported Location"]

    # ---- Ghost-job rules ---------------------------------------------------
    out["Why Removed"] = ""

    # Rule 1: exact same link listed twice
    out.loc[out["Link"].duplicated(), "Why Removed"] = "Exact duplicate listing"

    # Rule 2: same job, same employer, same town posted more than once.
    # Keep the newest copy; older copies are reposts of the same opening.
    out["_key"] = out["Job Title"].map(title_key) + "|" + out["Employer"].str.lower() + "|" + out["City"]
    newest_first = out.sort_values("Posted", ascending=False)
    is_repost = newest_first["_key"].duplicated() & (newest_first["Why Removed"] == "")
    out.loc[is_repost[is_repost].index, "Why Removed"] = "Older repost (newer copy kept)"

    # Rule 3: too old. Most real openings fill within a couple of months.
    too_old = (out["Days Old"] > max_age) & (out["Why Removed"] == "")
    months = (out["Days Old"] / 30.4).round().astype(int)
    out.loc[too_old, "Why Removed"] = "Posted " + months[too_old].astype(str) + " months ago"

    out = out.drop(columns="_key")
    removed = out["Why Removed"] != ""

    keep = (out[~removed].drop(columns="Why Removed")
            .sort_values(["County", "City", "Category", "Posted"],
                         ascending=[True, True, True, False]))
    ghosts = out[removed].sort_values("Posted", ascending=False)
    return keep, ghosts


# =============================================================================
# 5. WRITING THE WORKBOOK
# =============================================================================

HEADER_FILL = PatternFill("solid", fgColor="1F3A5F")
FRESH_FILLS = {"New": "D9F2E3", "Recent": "FFF4CC", "Aging": "FBE3D6"}
WIDTHS = {"Job Title": 45, "Employer": 30, "City": 16, "County": 11, "ZIP": 7,
          "Category": 24, "Occupation": 32, "Annual Pay": 12, "Est. Hourly": 11,
          "Pay Range": 13, "Agency?": 20, "Posted": 11, "Days Old": 9,
          "Freshness": 10, "Link": 10, "Original Location": 30, "Why Removed": 30}


def write_table(ws, df, table_name):
    """Write a dataframe as an Excel Table (gives sort/filter dropdowns)."""
    columns = list(df.columns)
    ws.append(columns)
    for row in df.itertuples(index=False):
        ws.append([None if pd.isna(v) else v for v in row])

    for i, col in enumerate(columns, start=1):
        letter = get_column_letter(i)
        ws.column_dimensions[letter].width = WIDTHS.get(col, 14)
        ws.cell(1, i).font = Font(bold=True, color="FFFFFF")
        ws.cell(1, i).fill = HEADER_FILL
        for r in range(2, len(df) + 2):
            cell = ws.cell(r, i)
            if col == "Posted":
                cell.number_format = "mm/dd/yyyy"
            elif col == "Annual Pay":
                cell.number_format = '"$"#,##0'
            elif col == "Est. Hourly":
                cell.number_format = '"$"0.00'
            elif col == "Link" and cell.value:
                cell.hyperlink = cell.value
                cell.value = "Open"
                cell.font = Font(color="0563C1", underline="single")
            elif col == "Freshness" and cell.value in FRESH_FILLS:
                cell.fill = PatternFill("solid", fgColor=FRESH_FILLS[cell.value])

    if len(df):
        ref = f"A1:{get_column_letter(len(columns))}{len(df) + 1}"
        table = Table(displayName=table_name, ref=ref)
        table.tableStyleInfo = TableStyleInfo(name="TableStyleLight9", showRowStripes=True)
        ws.add_table(table)
    ws.freeze_panes = "B2"   # keep header row and job title visible while scrolling


def write_summary(ws, keep):
    ws.append(["Open jobs by county and category"])
    ws["A1"].font = Font(bold=True, size=14)
    ws.append([])
    pivot = pd.crosstab(keep["County"], keep["Category"], margins=True, margins_name="Total")
    pivot = pivot.sort_values("Total", ascending=False)
    ws.append(["County"] + list(pivot.columns))
    for county, row in pivot.iterrows():
        ws.append([county] + [int(v) for v in row])
    for cell in ws[3]:
        cell.font = Font(bold=True, color="FFFFFF")
        cell.fill = HEADER_FILL
        cell.alignment = Alignment(wrap_text=True, vertical="top")
    ws.row_dimensions[3].height = 45
    ws.column_dimensions["A"].width = 14
    for i in range(2, len(pivot.columns) + 2):
        ws.column_dimensions[get_column_letter(i)].width = 11
    ws.freeze_panes = "B4"


def write_instructions(ws, report_date, max_age, n_total, n_keep, n_ghost, ghosts):
    reasons = ghosts["Why Removed"].str.replace(r"\d+ months ago", f"more than {max_age} days ago",
                                                regex=True).value_counts()
    lines = [
        ("South Central KY Open Jobs - Cleaned", True),
        (f"Source report dated {report_date:%B %d, %Y}", False),
        ("", False),
        (f"{n_total:,} postings in the original report", False),
        (f"{n_keep:,} kept on the 'Open Jobs' tab", True),
        (f"{n_ghost:,} moved to the 'Likely Filled' tab:", False),
        *[(f"     {count:,}  {reason}", False) for reason, count in reasons.items()],
        ("", False),
        ("HOW TO USE", True),
        ("- Every column header on 'Open Jobs' has a dropdown arrow. Click it to filter or sort.", False),
        ("- Filter County or City to find jobs close to someone. Filter Category to match their experience.", False),
        ("- Freshness: New = posted in the last 30 days (green), Recent = 31-60 days (yellow),", False),
        (f"  Aging = 61-{max_age} days (orange). Newer postings are much more likely to still be open.", False),
        ("- 'Open' in the Link column goes to the original posting.", False),
        ("- Pay: most postings don't list pay. 'Est. Hourly' is annual pay / 2080 hours.", False),
        ("- Agency?: staffing or travel agencies. Local temp agencies can be a good first step.", False),
        ("", False),
        ("NOTE", True),
        ("'Likely Filled' is a best guess based on age and reposts. The job report itself marks", False),
        ("everything 'Active', so nothing here confirms a job is filled. Check the link before referring someone.", False),
    ]
    for text, bold in lines:
        ws.append([text])
        ws.cell(ws.max_row, 1).font = Font(bold=bold, size=14 if ws.max_row == 1 else 11)
    ws.column_dimensions["A"].width = 110


# =============================================================================
# 6. JSON FOR THE WEBSITE
# =============================================================================

def write_json(path, keep, ghosts, report_date, n_total):
    """Save the open jobs as JSON for the job board site.

    Each job becomes a plain dictionary. Python's None turns into JSON null,
    so missing pay shows up as null in TypeScript instead of NaN.
    """
    def none_if_nan(value):
        return None if pd.isna(value) else value

    jobs = []
    # to_dict("records") gives one dictionary per row, keyed by column name
    for row in keep.to_dict("records"):
        jobs.append({
            # A short stable id from the posting URL (used as React's key)
            "id": hashlib.md5(row["Link"].encode()).hexdigest()[:10],
            "title": row["Job Title"],
            "employer": row["Employer"],
            "city": row["City"],
            "county": row["County"],
            "zip": row["ZIP"] or None,
            "category": row["Category"],
            "occupation": none_if_nan(row["Occupation"]),
            "annualPay": none_if_nan(row["Annual Pay"]),
            "hourlyPay": none_if_nan(row["Est. Hourly"]),
            "payRange": row["Pay Range"],
            "agency": row["Agency?"] != "",
            "posted": row["Posted"].strftime("%Y-%m-%d"),
            "daysOld": int(row["Days Old"]),
            "freshness": row["Freshness"],
            "url": row["Link"],
        })

    payload = {
        "reportDate": report_date.strftime("%Y-%m-%d"),
        "totalInReport": n_total,
        "removedCount": len(ghosts),
        "jobs": jobs,
    }
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, separators=(",", ":"))


def main():
    parser = argparse.ArgumentParser(description="Clean the South Central KY open job report.")
    parser.add_argument("input", help="the JobsEQ .xlsx export")
    parser.add_argument("-o", "--output", help="output file (default: <input> - Cleaned.xlsx)")
    parser.add_argument("--max-age", type=int, default=DEFAULT_MAX_AGE,
                        help=f"days before a posting counts as likely filled (default {DEFAULT_MAX_AGE})")
    parser.add_argument("--json", metavar="PATH",
                        help="also save the open jobs as JSON for the website, e.g. data/jobs.json")
    args = parser.parse_args()

    df, report_date = load_report(args.input)
    keep, ghosts = clean(df, report_date, args.max_age)

    if args.json:
        write_json(args.json, keep, ghosts, report_date, len(df))
        print(f"Saved website data: {args.json}")

    wb = Workbook()
    write_instructions(wb.active, report_date, args.max_age, len(df), len(keep), len(ghosts), ghosts)
    wb.active.title = "How To Use"
    write_table(wb.create_sheet("Open Jobs"), keep, "OpenJobs")
    write_summary(wb.create_sheet("Summary"), keep)
    write_table(wb.create_sheet("Likely Filled"), ghosts, "LikelyFilled")
    wb.active = 1   # open on the Open Jobs tab

    output = args.output or str(Path(args.input).with_name(Path(args.input).stem + " - Cleaned.xlsx"))
    wb.save(output)

    print(f"Report date: {report_date:%m/%d/%Y}")
    print(f"{len(df):,} postings -> {len(keep):,} open, {len(ghosts):,} likely filled")
    unknown = (keep["County"] == "Unknown").sum()
    if unknown:
        print(f"{unknown} jobs have a location the script didn't recognize - "
              f"add the town to CITY_TO_COUNTY.")
    print(f"Saved: {output}")


if __name__ == "__main__":
    main()
