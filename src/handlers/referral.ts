import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { registerMainMenuItem, inlineButton, inlineKeyboard } from "../toolkit/index.js";
import { getUser, getReferralCountForReferrer, getWallet, getSettings } from "../storage.js";

// Register the Referral button in the main menu
registerMainMenuItem({ label: "👥 Referrals", data: "referral:show", order: 30 });

const composer = new Composer<Ctx>();

// Handle the referral button tap
composer.callbackQuery("referral:show", async (ctx) => {
  await ctx.answerCallbackQuery();
  await showReferralInfo(ctx);
});

// Handle the /referral command
composer.command("referral", async (ctx) => {
  await showReferralInfo(ctx);
});

async function showReferralInfo(ctx: Ctx): Promise<void> {
  const userId = String(ctx.from!.id);
  const user = await getUser(userId);

  if (!user) {
    await ctx.reply(
      "👋 Please tap /start first to register.",
      { reply_markup: inlineKeyboard([[inlineButton("⬅️ Back to menu", "menu:main")]]) },
    );
    return;
  }

  // Get referral stats
  const referralCount = await getReferralCountForReferrer(userId);
  const wallet = await getWallet(userId);
  const settings = await getSettings();
  const botUsername = ctx.me?.username ?? "your_bot";

  // Build referral link
  const referralLink = `https://t.me/${botUsername}?start=ref_${userId}`;

  // Format earnings in dollars
  const earningsDollars = (wallet.balance / 100).toFixed(2);

  const message = [
    "👥 Your Referral Program",
    "",
    `🔗 Your referral link:`,
    referralLink,
    "",
    `📊 Referrals: ${referralCount}`,
    `💰 Earned: $${earningsDollars}`,
    "",
    `Invite friends and earn $${(settings.referral_reward_cents / 100).toFixed(2)} for each referral who completes their first search!`,
  ].join("\n");

  const keyboard = inlineKeyboard([
    [inlineButton("📢 Share referral link", `referral:share:${userId}`)],
    [inlineButton("⬅️ Back to menu", "menu:main")],
  ]);

  await ctx.reply(message, { reply_markup: keyboard });
}

// Handle the share referral link button
composer.callbackQuery(/^referral:share:(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const botUsername = ctx.me?.username ?? "your_bot";
  const referralLink = `https://t.me/${botUsername}?start=ref_${ctx.match![1]}`;

  await ctx.reply(
    "📢 Share this link with your friends:\n\n" +
    referralLink,
    {
      reply_markup: inlineKeyboard([
        [inlineButton("⬅️ Back to referrals", "referral:show")],
      ]),
    },
  );
});

export default composer;
