// Отдаёт браузеру публичные настройки базы из переменных окружения Vercel.
// Здесь только адрес и публичный (anon) ключ. Секретные ключи сюда не попадают.
export default function handler(req, res) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
  res.setHeader('Cache-Control', 'no-store');
  if (!supabaseUrl || !supabaseAnonKey) {
    return res.status(500).json({ error: 'not_configured' });
  }
  res.status(200).json({ supabaseUrl, supabaseAnonKey });
}
