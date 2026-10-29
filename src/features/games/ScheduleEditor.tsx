import { useState, type FormEvent } from 'react';
import type {
  DailySchedule,
  IsoWeekday,
  Schedule,
  WeeklySchedule,
} from '../../domain/schedule/types.ts';
import { parseSchedule } from '../../domain/schedule/validation.ts';
import type { ScheduleOverride } from '../../domain/storage/types.ts';
import {
  deleteScheduleOverride,
  setScheduleOverride,
} from '../../services/storage/index.ts';
import { scheduleSummary, weekdayName } from '../schedules/scheduleText.ts';

type EditableKind = 'daily' | 'weekly' | 'custom';

interface Draft {
  kind: EditableKind;
  time: string;
  timeZone: string;
  weekday: IsoWeekday;
  weekdays: IsoWeekday[];
}

const ALL_WEEKDAYS: readonly IsoWeekday[] = [1, 2, 3, 4, 5, 6, 7];

const TIME_ZONES: readonly string[] = (() => {
  try {
    return Array.from(
      new Set(['UTC', ...Intl.supportedValuesOf('timeZone')]),
    );
  } catch {
    return ['UTC'];
  }
})();

function editableSchedule(schedule: Schedule): Draft | null {
  switch (schedule.kind) {
    case 'daily':
    case 'weekly':
    case 'custom': {
      const timeZone =
        schedule.timeZone.kind === 'iana'
          ? schedule.timeZone.timeZone
          : schedule.timeZone.kind === 'utc'
            ? 'UTC'
            : null;
      if (timeZone === null) return null;
      return {
        kind: schedule.kind,
        time: schedule.time,
        timeZone,
        weekday: schedule.kind === 'weekly' ? schedule.weekday : 1,
        weekdays: schedule.kind === 'custom' ? schedule.weekdays : [1],
      };
    }
    case 'interval':
    case 'one-off':
      return null;
  }
}

function draftSchedule(draft: Draft): Schedule {
  const timeZone =
    draft.timeZone === 'UTC'
      ? ({ kind: 'utc' } as const)
      : ({ kind: 'iana', timeZone: draft.timeZone } as const);

  if (draft.kind === 'daily') {
    return { kind: 'daily', timeZone, time: draft.time } satisfies DailySchedule;
  }
  if (draft.kind === 'weekly') {
    return {
      kind: 'weekly',
      timeZone,
      time: draft.time,
      weekday: draft.weekday,
    } satisfies WeeklySchedule;
  }
  return {
    kind: 'custom',
    timeZone,
    time: draft.time,
    weekdays: [...draft.weekdays].sort((a, b) => a - b),
  };
}

export interface ScheduleEditorProps {
  gameId: string;
  serverId: string;
  schedule: Schedule;
  hasOverride: boolean;
  onOverrideChanged: (override: ScheduleOverride | undefined) => void;
}

export function ScheduleEditor({
  gameId,
  serverId,
  schedule,
  hasOverride,
  onOverrideChanged,
}: ScheduleEditorProps) {
  const initial = editableSchedule(schedule);
  const [draft, setDraft] = useState<Draft | null>(initial);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  if (draft === null) {
    return (
      <div className="schedule-editor">
        <p>This schedule type is not editable here.</p>
        {hasOverride ? (
          <button
            type="button"
            disabled={saving}
            onClick={() => {
              void restoreDefault();
            }}
          >
            Restore catalog default
          </button>
        ) : null}
        {message !== null ? <p role="alert">{message}</p> : null}
      </div>
    );
  }

  async function restoreDefault(): Promise<void> {
    setSaving(true);
    setMessage(null);
    try {
      await deleteScheduleOverride(`${gameId}::${serverId}`);
      onOverrideChanged(undefined);
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : 'The saved schedule could not be removed.',
      );
    } finally {
      setSaving(false);
    }
  }

  async function save(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setSaving(true);
    setMessage(null);
    try {
      const next = parseSchedule(draftSchedule(draft as Draft));
      const override = await setScheduleOverride({
        gameId,
        serverId,
        schedule: next,
      });
      onOverrideChanged(override);
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : 'The schedule could not be saved.',
      );
    } finally {
      setSaving(false);
    }
  }

  function toggleWeekday(weekday: IsoWeekday, checked: boolean): void {
    setDraft((current) => {
      if (current === null) return current;
      const weekdays = checked
        ? [...current.weekdays, weekday].sort((a, b) => a - b)
        : current.weekdays.filter((entry) => entry !== weekday);
      return { ...current, weekdays };
    });
  }

  const zoneOptions = TIME_ZONES.includes(draft.timeZone)
    ? TIME_ZONES
    : [draft.timeZone, ...TIME_ZONES];

  return (
    <form className="schedule-editor" onSubmit={(event) => void save(event)}>
      <p className="schedule-current">
        Current: {scheduleSummary(schedule)}
        {hasOverride ? ' (custom)' : ' (catalog default)'}
      </p>

      <label>
        Schedule type
        <select
          value={draft.kind}
          onChange={(event) => {
            const kind = event.target.value as EditableKind;
            setDraft({ ...draft, kind });
          }}
        >
          <option value="daily">Daily</option>
          <option value="weekly">Weekly</option>
          <option value="custom">Selected weekdays</option>
        </select>
      </label>

      <label>
        Reset time
        <input
          type="time"
          required
          value={draft.time}
          onChange={(event) => setDraft({ ...draft, time: event.target.value })}
        />
      </label>

      <label>
        Time zone
        <select
          value={draft.timeZone}
          onChange={(event) =>
            setDraft({ ...draft, timeZone: event.target.value })
          }
        >
          {zoneOptions.map((zone) => (
            <option key={zone} value={zone}>
              {zone}
            </option>
          ))}
        </select>
      </label>

      {draft.kind === 'weekly' ? (
        <label>
          Weekday
          <select
            value={draft.weekday}
            onChange={(event) =>
              setDraft({
                ...draft,
                weekday: Number(event.target.value) as IsoWeekday,
              })
            }
          >
            {ALL_WEEKDAYS.map((weekday) => (
              <option key={weekday} value={weekday}>
                {weekdayName(weekday)}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      {draft.kind === 'custom' ? (
        <fieldset>
          <legend>Weekdays</legend>
          <div className="weekday-options">
            {ALL_WEEKDAYS.map((weekday) => (
              <label key={weekday}>
                <input
                  type="checkbox"
                  checked={draft.weekdays.includes(weekday)}
                  onChange={(event) =>
                    toggleWeekday(weekday, event.target.checked)
                  }
                />
                {weekdayName(weekday)}
              </label>
            ))}
          </div>
        </fieldset>
      ) : null}

      <div className="button-row">
        <button type="submit" disabled={saving}>
          Save schedule
        </button>
        {hasOverride ? (
          <button
            type="button"
            disabled={saving}
            onClick={() => {
              void restoreDefault();
            }}
          >
            Restore catalog default
          </button>
        ) : null}
      </div>

      {message !== null ? <p role="alert">{message}</p> : null}
    </form>
  );
}
