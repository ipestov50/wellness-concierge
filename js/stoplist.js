// Единые правила стоп-листа: гость + получатель повода + близкие. Чистая функция без DOM —
// её используют и браузер (suggest.js), и серверные маршруты (api/draft.js, api/message.js).
const uniq = (a) => [...new Set((a || []).map((x) => String(x).trim()).filter(Boolean))];

export function stopList(client, people = [], person = null) {
  const guest = uniq([...(client?.allergies || []), ...(client?.diet || []), ...(client?.health || [])]);
  const recipient = person ? uniq(person.allergies) : null;
  const family = (people || [])
    .filter((p) => p && p.id !== person?.id && (p.allergies || []).length)
    .map((p) => ({ role: p.role || p.name || 'близкий', allergies: uniq(p.allergies) }));
  const all = uniq([...guest, ...(recipient || []), ...family.flatMap((f) => f.allergies)]);
  return { guest, recipient, family, all };
}
