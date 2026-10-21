// =============================================================================
// The settings you're most likely to change. Same rules the Python script had.
// =============================================================================

export const FRESH_DAYS = 30; // posted within this many days -> "New"
export const AGING_DAYS = 60; // within this many -> "Recent", else "Aging"
export const DEFAULT_MAX_AGE = 90; // older than this -> "Likely filled"

// Every town that shows up in the report, mapped to its county. The parser
// searches the raw location text for these names, so street addresses, store
// names, and "Bowling Green, KY 42101" all resolve the same way.
export const CITY_TO_COUNTY: Record<string, string> = {
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
};

// Misspellings seen in the data -> correct name
export const CITY_TYPOS: Record<string, string> = { Glasglow: "Glasgow" };

// Exact location strings that need a hand-picked answer: [city, county]
export const LOCATION_OVERRIDES: Record<string, [string, string]> = {
  "Kentucky Exposition Center": ["Louisville", "Jefferson"],
};

// Rough town centers, used only when a posting gives GPS coordinates
export const CITY_COORDS: Record<string, [number, number]> = {
  "Bowling Green": [36.99, -86.444], "Glasgow": [36.996, -85.912],
  "Franklin": [36.722, -86.577], "Russellville": [36.845, -86.887],
  "Scottsville": [36.753, -86.19], "Smiths Grove": [37.052, -86.208],
  "Leitchfield": [37.48, -86.294], "Columbia": [37.103, -85.306],
  "Morgantown": [37.226, -86.684], "Brownsville": [37.193, -86.267],
  "Horse Cave": [37.18, -85.907], "Edmonton": [36.98, -85.612],
  "Tompkinsville": [36.702, -85.692], "Beaver Dam": [37.402, -86.876],
};

// Staffing / travel agencies get labeled (not removed)
export const AGENCY_PATTERN = new RegExp(
  [
    "staffing", "med ?staff", "staff ?dna", "perm staff", "personnel", "recruit",
    "workforce", "employment professionals", "travelers", "vibra travels",
    "aya healthcare", "amn healthcare", "cynet", "anders group", "cross country",
    "trusted health", "vivian health", "aerotek", "^kelly$", "adecco", "manpower",
    "spherion", "vytalent", "proman",
  ].join("|"),
  "i",
);

// First two digits of a SOC code = one of 22 federal job families
export const SOC_CATEGORIES: Record<string, string> = {
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
};

// Specific occupations whose official family is misleading (full SOC code)
export const SOC_OVERRIDES: Record<string, string> = {
  "27-1026.00": "Sales & Retail", // Merchandise Displayers = store merchandisers
};

// Short words that stay capitalized when we fix ALL-CAPS titles
export const ACRONYMS = new Set([
  "RN", "LPN", "CNA", "CMA", "CDL", "PRN", "ICU", "ER", "OR", "PT", "OT",
  "HR", "IT", "KY", "US", "II", "III", "IV", "CNC", "DC", "EMT", "STNA",
  "ASL", "MRI", "CT", "LCSW", "APRN", "NP", "PA", "OTR", "AM", "PM", "WKU",
]);
