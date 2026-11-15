#!/bin/sh
# Публикация функции Jarvis в Supabase. Планировщик «Моего дня» общий с сайтом — копируем его перед публикацией.
set -e
cd "$(dirname "$0")/.."
cp js/planner.js supabase/functions/jarvis/planner.js
npx -y supabase@latest functions deploy jarvis --project-ref qkxxxincphseoyimeicb --use-api --no-verify-jwt --yes
