// Формы (запрос, клиент, партнёр) с чек-листами, дорогой и календарём выбора даты — тяжёлые,
// поэтому грузятся при первом открытии окна, а не при запуске приложения.
const forms = () => import('./forms.js');
export const editRequest = (...a) => forms().then((m) => m.editRequest(...a));
export const editClient = (...a) => forms().then((m) => m.editClient(...a));
export const editPartner = (...a) => forms().then((m) => m.editPartner(...a));
