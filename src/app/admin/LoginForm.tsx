"use client";

import { useActionState } from "react";
import { login } from "./actions";

export default function LoginForm() {
  // useActionState wires the form to the server action and gives us its
  // latest return value (the error message) plus a pending flag.
  const [state, formAction, pending] = useActionState(login, {});

  return (
    <form action={formAction} className="mt-8 max-w-sm space-y-4">
      <label className="block">
        <span className="block font-bold mb-1.5">Password</span>
        <input
          type="password"
          name="password"
          required
          autoComplete="current-password"
          autoFocus
          aria-invalid={Boolean(state.error)}
          aria-describedby={state.error ? "login-error" : undefined}
          className="w-full rounded-md border border-line bg-surface px-3.5 py-2.5"
        />
      </label>
      {state.error && (
        <p id="login-error" role="alert" className="font-bold text-[#9b2c1f]">
          {state.error}
        </p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-field text-white font-bold px-5 py-2.5 hover:bg-field-dark disabled:opacity-60"
      >
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
