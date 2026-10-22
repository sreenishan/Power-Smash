/** @jsxImportSource react */
// Spam trap (D-029). A real person never sees or reaches it: moved off-screen (not display:none, which some bots skip),
// aria-hidden, tabindex -1, autocomplete off. Its name comes from the lead contract and must not look like a real
// field to password managers.
export interface HoneypotProps {
  name: string;
  value: string;
  onChange: (name: string, value: string) => void;
}

const hidden = {
  position: 'absolute',
  left: '-10000px',
  top: 'auto',
  width: '1px',
  height: '1px',
  overflow: 'hidden',
} as const;

export function Honeypot({ name, value, onChange }: HoneypotProps) {
  return (
    <div style={hidden} aria-hidden="true">
      <label>
        Leave this field empty
        <input
          type="text"
          name={name}
          value={value}
          tabIndex={-1}
          autoComplete="off"
          data-1p-ignore="true"
          data-lpignore="true"
          onChange={(e) => onChange(name, e.target.value)}
        />
      </label>
    </div>
  );
}
