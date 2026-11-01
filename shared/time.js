const fault=message=>new Error(message);
/** Preserve fractional seconds instead of truncating them through Date.parse. */
export function normalizeInstant(value) {
  const m = typeof value==='string' && /^(\d{4})-(\d\d)-(\d\d)[Tt](\d\d):(\d\d):(\d\d)(?:\.(\d+))?([Zz]|[+-]\d\d:\d\d)$/.exec(value);
  if (!m) throw fault('playedAt: ожидается дата и время RFC 3339 с часовым поясом');
  const [y,month,day,hour,minute,second]=m.slice(1,7).map(Number);
  const maxDay=new Date(Date.UTC(y===0?400:y,month,0)).getUTCDate();
  if(month<1||month>12||day<1||day>maxDay||hour>23||minute>59||second>60) throw fault('playedAt: недопустимая дата или время');
  const offset=m[8].toUpperCase()==='Z'?0:(Number(m[8].slice(1,3))*60+Number(m[8].slice(4)))*(m[8][0]==='-'?-1:1);
  if(m[8].length>1&&(Number(m[8].slice(1,3))>23||Number(m[8].slice(4))>59)) throw fault('playedAt: неверный часовой пояс');
  const d=new Date(0);d.setUTCFullYear(y,month-1,day);d.setUTCHours(hour,minute,Math.min(second,59),0);d.setTime(d.getTime()-offset*60000);
  if(second===60 && !(d.getUTCHours()===23&&d.getUTCMinutes()===59&&((d.getUTCMonth()===5&&d.getUTCDate()===30)||(d.getUTCMonth()===11&&d.getUTCDate()===31)))) throw fault('playedAt: неверная дополнительная секунда');
  const fraction=(m[7]??'').replace(/0+$/,'');
  const base=d.toISOString().slice(0,-5);
  return (second===60?base.slice(0,-2)+'60':base)+(fraction?'.'+fraction:'')+'Z';
}
export function validDateTime(value) { try { normalizeInstant(value);return true; } catch { return false; } }
