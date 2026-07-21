import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { registerMainMenuItem, inlineButton, inlineKeyboard } from "../toolkit/index.js";
import { getUser, saveUser, getReferral, saveReferral, creditBalance, getSettings } from "../storage.js";

// Register the Search button in the main menu
registerMainMenuItem({ label: "🔍 Search", data: "search:start", order: 10 });

const composer = new Composer<Ctx>();

// Search results are sourced internally (per spec assumptions)
function generateSearchResults(query: string): string[] {
  const results = [
    `Result 1: Information about "${query}"`,
    `Result 2: More details on "${query}"`,
    `Result 3: Related topics for "${query}"`,
  ];
  return results;
}

// Handle the search button tap — enter search mode
composer.callbackQuery("search:start", async (ctx) => {
  await ctx.answerCallbackQuery();
  ctx.session.step = "awaiting_search";
  await ctx.editMessageText(
    "🔍 Type your search query below and I'll find results for you.",
    {
      reply_markup: inlineKeyboard([[inlineButton("⬅️ Back to menu", "menu:main")]]),
    },
  );
});

// Handle the /search command — enter search mode or process inline query
composer.command("search", async (ctx) => {
  const query = ctx.message?.text?.replace(/^\/search\s*/, "")?.trim();
  if (query) {
    await processSearch(ctx, query);
  } else {
    ctx.session.step = "awaiting_search";
    await ctx.reply(
      "🔍 What would you like to search for?\n\nType your query after the command, or tap the Search button and type your query.",
      {
        reply_markup: inlineKeyboard([[inlineButton("⬅️ Back to menu", "menu:main")]]),
      },
    );
  }
});

// Handle text input when in search mode
composer.on("message:text", async (ctx, next) => {
  if (ctx.session.step !== "awaiting_search") {
    return next();
  }

  const query = ctx.message.text.trim();
  if (query.length < 2) {
    await ctx.reply("Query too short — try at least 2 characters.");
    return;
  }

  await processSearch(ctx, query);
});

async function processSearch(ctx: Ctx, query: string): Promise<void> {
  const userId = String(ctx.from!.id);

  // Reset session step
  ctx.session.step = "idle";

  // Show typing indicator for search
  await ctx.replyWithChatAction("typing");

  // Generate search results
  const results = generateSearchResults(query);

  // Format results with buttons
  const resultText = results.join("\n\n");
  const keyboard = inlineKeyboard([
    [inlineButton("🔍 New search", "search:start")],
    [inlineButton("⬅️ Back to menu", "menu:main")],
  ]);

  await ctx.reply(
    `📋 Results for "${query}":\n\n${resultText}`,
    { reply_markup: keyboard },
  );

  // Track referral's first search (if user was referred)
  const user = await getUser(userId);
  if (user?.referrer_id) {
    const settings = await getSettings();
    const referral = await getReferral(user.referrer_id, userId);

    if (referral && !referral.first_search_date && !referral.credited) {
      // This is the referee's first search — credit the referrer
      referral.first_search_date = new Date().toISOString();
      await saveReferral(referral);

      // Credit the referrer
      await creditBalance(user.referrer_id, settings.referral_reward_cents);
    }
  }
}

export default composer;
