import * as Adapter from '@/utils/adapters';
import * as Services from '@/services';

export async function GetCurrentHours() {
  const collectors = [
    Services.Time.GetCurrentDateTimeFromTaobao,
    // Services.Time.GetCurrentDateTimeFromJd,
    // Services.Time.GetCurrentDateTimeFromSuning,
  ];
  return Adapter.ChokePreemptiveAdapter<string>(collectors);
}
