/**
 * @gusto/ui-web — Shared React Components
 *
 * Re-usable UI components shared between pos-ui, kds-tv, and web-admin.
 * Built with Tailwind CSS. Add shadcn/ui components here as needed.
 */

export function GustoLogo({ className }: { className?: string }) {
  return (
    <div className={className}>
      <span style={{ fontWeight: 800, fontSize: "1.5rem", letterSpacing: "-0.02em" }}>
        Gusto's
      </span>
    </div>
  );
}

// Placeholder — add shadcn/ui components here as the project grows
export const GUSTO_VERSION = "0.0.1";
