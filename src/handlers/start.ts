import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { mainMenuKeyboard, inlineButton, inlineKeyboard } from "../toolkit/index.js";
import { getUser, saveUser, type User } from "../storage.js";

// The /start handler renders the bot's MAIN MENU — the primary way users operate
// a button-first bot. A feature adds its own button by calling
// `registerMainMenuItem(...)` in its own `src/handlers/<slug>.ts`; this handler
// renders whatever is registered (plus a Help button), so you do NOT edit this
// file to add a feature.
const composer = new Composer<Ctx>();

const WELCOME = "👋 Welcome! Tap a button below to get started.";

composer.command("start", async (ctx) => {
  const userId = String(ctx.from!.id);
  const name = ctx.from!.first_name;
  const username = ctx.from!.username;

  // Check if user already exists
  let user = await getUser(userId);

  if (!user) {
    // New user — register them
    user = {
      id: userId,
      name,
      username,
      registration_date: new Date().toISOString(),
    };

    // Check for referral code in /start payload
    const payload = ctx.match;
    if (payload && typeof payload === "string" && payload.startsWith("ref_")) {
      const referrerId = payload.replace("ref_", "");
      if (referrerId !== userId) {
        user.referrer_id = referrerId;
      }
    }

    await saveUser(user);
  }

  // Build main menu
  await ctx.reply(WELCOME, { reply_markup: mainMenuKeyboard() });
});

// "Back to menu" — re-render the main menu in place from any sub-view.
composer.callbackQuery("menu:main", async (ctx) => {
  await ctx.answerCallbackQuery();
  await ctx.editMessageText(WELCOME, { reply_markup: mainMenuKeyboard() });
});

export default composer;
