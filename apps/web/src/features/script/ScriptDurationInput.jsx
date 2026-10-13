export function ScriptDurationInput({ className, label, value, onChange, onCommit, commitOnEnter = false }) {
  return (
    <label className={className}>
      <span>{label}</span>
      <span className="script-seconds-input">
        <input
          aria-label={`${label}（秒）`}
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          value={value}
          onChange={(event) => onChange(event.target.value.replace(/\D/g, ''))}
          onBlur={() => void onCommit()}
          onKeyDown={commitOnEnter ? (event) => event.key === 'Enter' && void onCommit() : undefined}
        />
        <em>秒</em>
      </span>
    </label>
  )
}
