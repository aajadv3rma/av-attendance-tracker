import type { JsonObject } from "@/db/schema";
import { formatDuration } from "@/lib/time";

export type BreakEntry = {
  startAt: string;
  endAt?: string | null;
  paid?: boolean;
  label?: string;
};

type OvertimeOptions = {
  method?: string;
  earlyArrivalEligible?: boolean;
  afterShiftEligible?: boolean;
  minOvertimeMinutes?: number;
  roundingMinutes?: number;
  maxDailyMinutes?: number | null;
  dailyThresholdMinutes?: number;
  weeklyThresholdMinutes?: number;
  gracePeriodMinutes?: number;
  approvalRequired?: boolean;
};

function minutesBetween(start: string | Date, end: string | Date) {
  const milliseconds = new Date(end).getTime() - new Date(start).getTime();
  return Number.isFinite(milliseconds) ? Math.max(0, Math.floor(milliseconds / 60_000)) : 0;
}

function breakDuration(entries: BreakEntry[], start?: Date | null, end?: Date | null) {
  return entries.reduce((sum, entry) => {
    if (entry.paid || !entry.startAt || !entry.endAt) return sum;
    const breakStart = new Date(entry.startAt);
    const breakEnd = new Date(entry.endAt);
    if (!Number.isFinite(breakStart.getTime()) || !Number.isFinite(breakEnd.getTime())) return sum;
    const clippedStart = start ? Math.max(breakStart.getTime(), start.getTime()) : breakStart.getTime();
    const clippedEnd = end ? Math.min(breakEnd.getTime(), end.getTime()) : breakEnd.getTime();
    return sum + Math.max(0, Math.floor((clippedEnd - clippedStart) / 60_000));
  }, 0);
}

export function calculateRecord(input: {
  startAt?: Date | string | null;
  endAt?: Date | string | null;
  scheduledStartAt?: Date | string | null;
  scheduledEndAt?: Date | string | null;
  scheduledPayableMinutes?: number;
  breakEntries?: BreakEntry[];
  overtimeOptions?: OvertimeOptions;
  status?: string;
}) {
  const { startAt, endAt, scheduledStartAt, scheduledEndAt } = input;
  const started = startAt ? new Date(startAt) : null;
  const ended = endAt ? new Date(endAt) : null;
  const scheduledStart = scheduledStartAt ? new Date(scheduledStartAt) : null;
  const scheduledEnd = scheduledEndAt ? new Date(scheduledEndAt) : null;
  const breaks = input.breakEntries ?? [];
  const options = input.overtimeOptions ?? {};
  const complete = started && ended && ended >= started;
  const actualMinutes = complete ? minutesBetween(started, ended) : 0;
  const unpaidBreakMinutes = complete ? breakDuration(breaks, started, ended) : 0;
  const netMinutes = Math.max(0, actualMinutes - unpaidBreakMinutes);
  const scheduledPayableMinutes = Math.max(0, Math.floor(input.scheduledPayableMinutes ?? 0));
  const gracePeriodMinutes = Math.max(0, Math.floor(options.gracePeriodMinutes ?? 0));
  const lateMinutes = complete && scheduledStart && started && started > scheduledStart ? minutesBetween(scheduledStart, started) : 0;
  const earlyDepartureMinutes = complete && scheduledEnd && ended && ended < scheduledEnd ? minutesBetween(ended, scheduledEnd) : 0;
  const isLateAfterGrace = lateMinutes > gracePeriodMinutes;
  const method = options.method ?? "scheduled-shift";
  let eligibleMinutes = netMinutes;

  if (complete && scheduledStart && scheduledEnd) {
    const eligibleStart = options.earlyArrivalEligible
      ? started
      : new Date(Math.max(started.getTime(), scheduledStart.getTime()));
    const eligibleEnd = options.afterShiftEligible
      ? ended
      : new Date(Math.min(ended.getTime(), scheduledEnd.getTime()));
    eligibleMinutes = eligibleEnd > eligibleStart
      ? Math.max(0, minutesBetween(eligibleStart, eligibleEnd) - breakDuration(breaks, eligibleStart, eligibleEnd))
      : 0;
  }

  const dailyThreshold = Math.max(0, Math.floor(options.dailyThresholdMinutes ?? scheduledPayableMinutes));
  const baseline = method === "daily-threshold" ? dailyThreshold : scheduledPayableMinutes;
  let overtimeMinutes = complete ? Math.max(0, eligibleMinutes - baseline) : 0;
  const minimum = Math.max(0, Math.floor(options.minOvertimeMinutes ?? 0));
  if (overtimeMinutes < minimum) overtimeMinutes = 0;
  const rounding = Math.max(1, Math.floor(options.roundingMinutes ?? 1));
  if (rounding > 1) overtimeMinutes = Math.round(overtimeMinutes / rounding) * rounding;
  if (typeof options.maxDailyMinutes === "number" && options.maxDailyMinutes > 0) {
    overtimeMinutes = Math.min(overtimeMinutes, options.maxDailyMinutes);
  }

  const calculation: JsonObject = {
    method,
    formula: "max(0, eligible actual minutes − scheduled payable minutes)",
    actualMinutes,
    unpaidBreakMinutes,
    netMinutes,
    eligibleMinutes,
    scheduledPayableMinutes,
    baselineMinutes: baseline,
    gracePeriodMinutes,
    lateMinutes,
    lateAfterGracePeriod: isLateAfterGrace,
    earlyDepartureMinutes,
    earlyArrivalEligible: Boolean(options.earlyArrivalEligible),
    afterShiftEligible: options.afterShiftEligible !== false,
    minimumOvertimeMinutes: minimum,
    roundingMinutes: rounding,
    rawOvertimeMinutes: complete ? Math.max(0, eligibleMinutes - baseline) : 0,
    overtimeMinutes,
    display: `${formatDuration(eligibleMinutes)} eligible − ${formatDuration(baseline)} scheduled = ${formatDuration(overtimeMinutes)} overtime`,
  };

  return {
    actualMinutes,
    breakMinutes: unpaidBreakMinutes,
    netMinutes,
    overtimeMinutes,
    overtimeMethod: method,
    overtimeCalculation: calculation,
  };
}

export function calculateWeeklyOvertime(records: Array<{
  id: string;
  netMinutes: number;
  scheduledPayableMinutes: number;
  overtimeCalculation?: Record<string, unknown> | null;
}>, thresholdMinutes: number) {
  let accrued = 0;
  const output: Record<string, number> = {};
  for (const record of [...records].sort((a, b) => a.id.localeCompare(b.id))) {
    const eligible = Math.max(0, record.netMinutes);
    const previous = accrued;
    accrued += eligible;
    const beforeThreshold = Math.max(0, thresholdMinutes - previous);
    output[record.id] = Math.max(0, eligible - beforeThreshold);
  }
  return output;
}

export function calculateStudentTargets(attended: number, conducted: number, target: number) {
  const safeAttended = Math.max(0, Math.floor(attended));
  const safeConducted = Math.max(0, Math.floor(conducted));
  const percentage = Math.min(100, Math.max(0, target));
  const missedCanTake = percentage >= 100 ? 0 : Math.max(0, Math.floor(safeAttended / (percentage / 100) - safeConducted));
  const requiredToReach = percentage >= 100
    ? (safeAttended === safeConducted ? 0 : Number.POSITIVE_INFINITY)
    : Math.max(0, Math.ceil((percentage * safeConducted - 100 * safeAttended) / (100 - percentage)));
  return {
    percentage: safeConducted === 0 ? 0 : Math.round((safeAttended / safeConducted) * 1000) / 10,
    missedCanTake,
    requiredToReach,
    attended: safeAttended,
    conducted: safeConducted,
    target: percentage,
  };
}

export function calculatePayEstimate(minutes: number, hourlyRate: number, multiplier: number) {
  const overtimeHours = Math.max(0, minutes) / 60;
  const rate = Math.max(0, hourlyRate);
  const factor = Math.max(0, multiplier);
  return { overtimeHours, hourlyRate: rate, multiplier: factor, estimatedPay: Math.round(overtimeHours * rate * factor * 100) / 100 };
}
