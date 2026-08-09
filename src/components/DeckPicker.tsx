import type { SpiceLevel } from '@game/shared/types';
import { SPICE_LABELS } from '@game/shared/constants';
import { DEEP_LEVELS, SPICE_LEVELS } from '@game/shared/types';

/**
 * 题库选择器。分两组：尺度档偏调情，深聊档偏交心。
 * 建房和等待室共用，避免两处写法分化。
 */
export function DeckPicker({
  value,
  onChange,
  disabled,
}: {
  value: SpiceLevel;
  onChange: (lv: SpiceLevel) => void;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-3">
      <Group
        title="想撩"
        levels={SPICE_LEVELS}
        value={value}
        onChange={onChange}
        disabled={disabled}
        cols="grid-cols-3"
      />
      <Group
        title="想聊"
        levels={DEEP_LEVELS}
        value={value}
        onChange={onChange}
        disabled={disabled}
        cols="grid-cols-3"
      />
    </div>
  );
}

function Group({
  title,
  levels,
  value,
  onChange,
  disabled,
  cols,
}: {
  title: string;
  levels: readonly SpiceLevel[];
  value: SpiceLevel;
  onChange: (lv: SpiceLevel) => void;
  disabled?: boolean;
  cols: string;
}) {
  return (
    <div>
      <p className="mb-1.5 text-[11px] tracking-[0.2em] text-blush/40">{title}</p>
      <div className={`grid gap-2 ${cols}`}>
        {levels.map((lv) => (
          <button
            key={lv}
            disabled={disabled}
            onClick={() => onChange(lv)}
            className={`rounded-xl border py-2 text-sm transition disabled:opacity-40 ${
              value === lv
                ? 'border-rose bg-rose/20 text-white'
                : 'border-blush/20 text-blush/60'
            }`}
          >
            {SPICE_LABELS[lv]}
          </button>
        ))}
      </div>
    </div>
  );
}
