import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { registerMainMenuItem, inlineButton, inlineKeyboard } from "../toolkit/index.js";
import {
  getAllUserIds,
  getUser,
  getUserCount,
  getReferralCountForReferrer,
  getPendingWithdrawals,
  getPendingWithdrawalsCount,
  getWallet,
  getSettings,
  saveWithdrawal,
  removeWithdrawalFromPending,
  saveWallet,
  getWithdrawal,
  type WithdrawalRequest,
} from "../storage.js";

// Register the Admin Dashboard button in the main menu
registerMainMenuItem({ label: "⚙️ Admin", data: "admin:dashboard", order: 99 });

const composer = new Composer<Ctx>();

// Admin user ID from environment (the owner @CHARLIES801)
const ADMIN_USER_ID = process.env.ADMIN_USER_ID ?? "CHARLIES801";

function isAdmin(userId: string): boolean {
  return userId === ADMIN_USER_ID;
}

// Handle the admin dashboard button tap
composer.callbackQuery("admin:dashboard", async (ctx) => {
  await ctx.answerCallbackQuery();

  const userId = String(ctx.from!.id);
  if (!isAdmin(userId)) {
    await ctx.reply(
      "⛔ Access denied. This feature is only available to admins.",
      {
        reply_markup: inlineKeyboard([[inlineButton("⬅️ Back to menu", "menu:main")]]),
      },
    );
    return;
  }

  await showAdminDashboard(ctx);
});

// Show admin dashboard with overview
async function showAdminDashboard(ctx: Ctx): Promise<void> {
  const userCount = await getUserCount();
  const pendingCount = await getPendingWithdrawalsCount();

  const message = [
    "⚙️ Admin Dashboard",
    "",
    `👥 Total users: ${userCount}`,
    `💸 Pending withdrawals: ${pendingCount}`,
    "",
    "Select an option to manage:",
  ].join("\n");

  await ctx.reply(message, {
    reply_markup: inlineKeyboard([
      [inlineButton("👥 View users", "admin:users")],
      [inlineButton("💸 Pending withdrawals", "admin:withdrawals")],
      [inlineButton("⚙️ Settings", "admin:settings")],
      [inlineButton("⬅️ Back to menu", "menu:main")],
    ]),
  });
}

// Handle view users button
composer.callbackQuery("admin:users", async (ctx) => {
  await ctx.answerCallbackQuery();

  const userId = String(ctx.from!.id);
  if (!isAdmin(userId)) {
    await ctx.reply("⛔ Access denied.");
    return;
  }

  const userIds = await getAllUserIds();
  if (userIds.length === 0) {
    await ctx.reply(
      "👥 No users registered yet.",
      {
        reply_markup: inlineKeyboard([
          [inlineButton("⬅️ Back to dashboard", "admin:dashboard")],
        ]),
      },
    );
    return;
  }

  // Show first 10 users
  const displayUsers = userIds.slice(0, 10);
  const lines = ["👥 Registered Users:\n"];

  for (const uid of displayUsers) {
    const user = await getUser(uid);
    if (user) {
      const referralCount = await getReferralCountForReferrer(uid);
      const wallet = await getWallet(uid);
      const balance = (wallet.balance / 100).toFixed(2);
      lines.push(`• ${user.name} (@${user.username ?? "N/A"}) - $${balance} - ${referralCount} referrals`);
    }
  }

  if (userIds.length > 10) {
    lines.push(`\n... and ${userIds.length - 10} more users`);
  }

  await ctx.reply(lines.join("\n"), {
    reply_markup: inlineKeyboard([
      [inlineButton("⬅️ Back to dashboard", "admin:dashboard")],
    ]),
  });
});

// Handle pending withdrawals button
composer.callbackQuery("admin:withdrawals", async (ctx) => {
  await ctx.answerCallbackQuery();

  const userId = String(ctx.from!.id);
  if (!isAdmin(userId)) {
    await ctx.reply("⛔ Access denied.");
    return;
  }

  const withdrawals = await getPendingWithdrawals();
  if (withdrawals.length === 0) {
    await ctx.reply(
      "💸 No pending withdrawals.",
      {
        reply_markup: inlineKeyboard([
          [inlineButton("⬅️ Back to dashboard", "admin:dashboard")],
        ]),
      },
    );
    return;
  }

  // Show pending withdrawals
  const lines = ["💸 Pending Withdrawals:\n"];

  for (const w of withdrawals.slice(0, 5)) {
    const user = await getUser(w.user_id);
    lines.push(`• ${user?.name ?? w.user_id}: $${(w.amount / 100).toFixed(2)} via ${w.method}`);
    lines.push(`  ID: ${w.id}`);
    lines.push("");
  }

  if (withdrawals.length > 5) {
    lines.push(`... and ${withdrawals.length - 5} more pending`);
  }

  await ctx.reply(lines.join("\n"), {
    reply_markup: inlineKeyboard([
      ...withdrawals.slice(0, 5).map(w => [
        inlineButton(`✅ Approve $${(w.amount / 100).toFixed(2)}`, `withdraw:admin:approve:${w.id}`),
        inlineButton(`❌ Reject`, `withdraw:admin:reject:${w.id}`),
      ]),
      [inlineButton("⬅️ Back to dashboard", "admin:dashboard")],
    ]),
  });
});

// Handle settings button
composer.callbackQuery("admin:settings", async (ctx) => {
  await ctx.answerCallbackQuery();

  const userId = String(ctx.from!.id);
  if (!isAdmin(userId)) {
    await ctx.reply("⛔ Access denied.");
    return;
  }

  const settings = await getSettings();

  const message = [
    "⚙️ Bot Settings",
    "",
    `Referral reward: $${(settings.referral_reward_cents / 100).toFixed(2)}`,
    `Min withdrawal: $${(settings.min_withdrawal_cents / 100).toFixed(2)}`,
    `Max withdrawal: $${(settings.max_withdrawal_cents / 100).toFixed(2)}`,
    `Admin chat: ${settings.admin_chat_id ?? "Not configured"}`,
  ].join("\n");

  await ctx.reply(message, {
    reply_markup: inlineKeyboard([
      [inlineButton("⬅️ Back to dashboard", "admin:dashboard")],
    ]),
  });
});

// Handle withdrawal approval
composer.callbackQuery(/^withdraw:admin:approve:(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();

  const adminId = String(ctx.from!.id);
  if (!isAdmin(adminId)) {
    await ctx.reply("⛔ Access denied.");
    return;
  }

  const withdrawalId = ctx.match![1];
  const withdrawal = await getWithdrawal(withdrawalId);

  if (!withdrawal || withdrawal.status !== "pending") {
    await ctx.reply("❌ Withdrawal not found or already processed.");
    return;
  }

  // Update withdrawal status
  withdrawal.status = "approved";
  await saveWithdrawal(withdrawal);
  await removeWithdrawalFromPending(withdrawalId);

  // Deduct from pending
  const wallet = await getWallet(withdrawal.user_id);
  wallet.pending_withdrawals -= withdrawal.amount;
  await saveWallet(wallet);

  // Notify user
  try {
    await ctx.api.sendMessage(
      withdrawal.user_id,
      `✅ Your withdrawal of $${(withdrawal.amount / 100).toFixed(2)} has been approved!\n\n` +
      `Request ID: ${withdrawalId}\n\n` +
      `You should receive your payment shortly.`,
    );
  } catch (error) {
    console.error("Failed to notify user:", error);
  }

  await ctx.reply(`✅ Withdrawal ${withdrawalId} approved.`);
});

// Handle withdrawal rejection
composer.callbackQuery(/^withdraw:admin:reject:(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();

  const adminId = String(ctx.from!.id);
  if (!isAdmin(adminId)) {
    await ctx.reply("⛔ Access denied.");
    return;
  }

  const withdrawalId = ctx.match![1];
  const withdrawal = await getWithdrawal(withdrawalId);

  if (!withdrawal || withdrawal.status !== "pending") {
    await ctx.reply("❌ Withdrawal not found or already processed.");
    return;
  }

  // Update withdrawal status
  withdrawal.status = "rejected";
  await saveWithdrawal(withdrawal);
  await removeWithdrawalFromPending(withdrawalId);

  // Refund to wallet
  const wallet = await getWallet(withdrawal.user_id);
  wallet.balance += withdrawal.amount;
  wallet.pending_withdrawals -= withdrawal.amount;
  await saveWallet(wallet);

  // Notify user
  try {
    await ctx.api.sendMessage(
      withdrawal.user_id,
      `❌ Your withdrawal of $${(withdrawal.amount / 100).toFixed(2)} has been rejected.\n\n` +
      `Request ID: ${withdrawalId}\n\n` +
      `The amount has been refunded to your balance.`,
    );
  } catch (error) {
    console.error("Failed to notify user:", error);
  }

  await ctx.reply(`❌ Withdrawal ${withdrawalId} rejected.`);
});

export default composer;
