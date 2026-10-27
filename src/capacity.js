export function calculateCapacity(data, settings) {
  const minutesPerImpression = Number(settings.minutesPerImpression);
  const machineCount = Number(settings.machineCount);
  if (!minutesPerImpression || !machineCount) return null;

  const requiredMinutes = Number(data.totalImpressions || 0) * minutesPerImpression
    + Number(data.uniquePo || 0) * Number(settings.setupMinutesPerPo || 0);
  const capacityPerMachine = Number(settings.shiftsPerDay)
    * Number(settings.minutesPerShift)
    * (Number(settings.efficiencyPercent) / 100)
    * Number(settings.planningDays);
  if (capacityPerMachine <= 0) return null;

  const machinesRequired = Math.ceil(requiredMinutes / capacityPerMachine);
  const availableMinutes = capacityPerMachine * machineCount;
  const coverageRate = requiredMinutes > 0 ? Math.min(1, availableMinutes / requiredMinutes) : 1;
  const printableQuantity = Math.floor(Number(data.totalQuantity || 0) * coverageRate);
  const deliverableQuantity = printableQuantity;
  const shortageQuantity = Math.max(0, Number(data.totalQuantity || 0) - deliverableQuantity);

  return {
    requiredMinutes,
    capacityPerMachine,
    availableMinutes,
    coverageRate,
    printableQuantity,
    deliverableQuantity,
    shortageQuantity,
    machinesRequired,
    gap: machineCount - machinesRequired
  };
}
