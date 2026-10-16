-- Gamification (XP, levels, daily streaks, leaderboard) is removed from the product.
-- Bloom's-taxonomy mastery is unaffected: it is computed from graded quiz answers.

DROP TABLE IF EXISTS "XpEvent";
DROP TABLE IF EXISTS "UserGamification";
