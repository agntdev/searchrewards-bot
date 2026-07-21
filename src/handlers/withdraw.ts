import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { registerMainMenuItem, inlineButton, inlineKeyboard, confirmKeyboard } from "../toolkit/index.js";
import {
  getUser,
  getWallet,
  saveWallet,
  getSettings,
  saveWithdrawal,
  generateWithdrawalId,
} from "../storage.js";

// Register the Withdraw button in the main menu
registerMainMenuItem({ label: "💸 Withdraw", data: "withdraw:start", order: 40 });

const composer = new Composer<Ctx>();

// Handle the withdraw button tap
composer.callbackQuery("withdraw:start", async (ctx) => {
  await ctx.answerCallbackQuery();
  await startWithdrawal(ctx);
});

// Handle the /withdraw command
composer.command("withdraw", async (ctx) => {
  await startWithdrawal(ctx);
});

async function startWithdrawal(ctx: Ctx): Promise<void> {
  const userId = String(ctx.from!.id);
  const user = await getUser(userId);

  if (!user) {
    await ctx.reply(
      "👋 Please tap /start first to register.",
      { reply_markup: inlineKeyboard([[inlineButton("⬅️ Back to menu", "menu:main")]]) },
    );
    return;
  }

  const wallet = await getWallet(userId);
  const settings = await getSettings();
  const minWithdrawal = (settings.min_withdrawal_cents / 100).toFixed(2);
  const maxWithdrawal = (settings.max_withdrawal_cents / 100).toFixed(2);
  const balance = (wallet.balance / 100).toFixed(2);

  // Check if user has sufficient balance
  if (wallet.balance < settings.min_withdrawal_cents) {
    await ctx.reply(
      `💸 Withdrawal\n\n` +
      `Your balance: $${balance}\n` +
      `Minimum withdrawal: $${minWithdrawal}\n\n` +
      `You don't have enough to withdraw yet. Keep searching to earn more!`,
      {
        reply_markup: inlineKeyboard([
          [inlineButton("🔍 Search", "search:start")],
          [inlineButton("⬅️ Back to menu", "menu:main")],
        ]),
      },
    );
    return;
  }

  // Set flow state
  ctx.session.step = "awaiting_withdrawal_amount";
  ctx.session.flowData = {};

  await ctx.reply(
    `💸 Withdrawal\n\n` +
    `Your balance: $${balance}\n` +
    `Min: $${minWithdrawal} | Max: $${maxWithdrawal}\n\n` +
    `How much would you like to withdraw? (in USD)`,
    {
      reply_markup: {
        force_reply: true,
        input_field_placeholder: "Enter amount in USD...",
      },
    },
  );
}

// Handle the amount input
composer.on("message:text", async (ctx, next) => {
  if (ctx.session.step !== "awaiting_withdrawal_amount") {
    return next();
  }

  const text = ctx.message.text.trim();
  const amount = parseFloat(text);

  if (isNaN(amount) || amount <= 0) {
    await ctx.reply("Please enter a valid amount (e.g., 5.00).");
    return;
  }

  const settings = await getSettings();
  const amountCents = Math.round(amount * 100);

  if (amountCents < settings.min_withdrawal_cents) {
    await ctx.reply(
      `Minimum withdrawal is $${(settings.min_withdrawal_cents / 100).toFixed(2)}. Try a larger amount.`,
    );
    return;
  }

  if (amountCents > settings.max_withdrawal_cents) {
    await ctx.reply(
      `Maximum withdrawal is $${(settings.max_withdrawal_cents / 100).toFixed(2)}. Try a smaller amount.`,
    );
    return;
  }

  const wallet = await getWallet(String(ctx.from!.id));
  if (amountCents > wallet.balance) {
    await ctx.reply(
      `You only have $${(wallet.balance / 100).toFixed(2)} available. Try a smaller amount.`,
    );
    return;
  }

  // Store amount and move to next step
  ctx.session.flowData!.withdrawalAmount = amountCents;
  ctx.session.step = "awaiting_withdrawal_method";

  await ctx.reply(
    `💸 Withdraw $${amount.toFixed(2)}\n\n` +
    `How would you like to receive your payment?`,
    {
      reply_markup: inlineKeyboard([
        [inlineButton("💳 PayPal", "withdraw:method:paypal")],
        [inlineButton("🏦 Bank Transfer", "withdraw:method:bank")],
        [inlineButton("📱 Crypto Wallet", "withdraw:method:crypto")],
        [inlineButton("⬅️ Cancel", "withdraw:cancel")],
      ]),
    },
  );
});

// Handle method selection
composer.callbackQuery(/^withdraw:method:(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const method = ctx.match![1];
  const methodName = method === "paypal" ? "PayPal" : method === "bank" ? "Bank Transfer" : "Crypto Wallet";

  ctx.session.flowData!.withdrawalMethod = method;
  ctx.session.step = "awaiting_withdrawal_account";

  await ctx.reply(
    `💸 Withdraw via ${methodName}\n\n` +
    `Please provide your ${methodName} details:`,
    {
      reply_markup: {
        force_reply: true,
        input_field_placeholder: method === "paypal" ? "Enter PayPal email..." : method === "bank" ? "Enter account details..." : "Enter wallet address...",
      },
    },
  );
});

// Handle account details input
composer.on("message:text", async (ctx, next) => {
  if (ctx.session.step !== "awaiting_withdrawal_account") {
    return next();
  }

  const text = ctx.message.text.trim();
  if (text.length < 3) {
    await ctx.reply("Please provide valid account details.");
    return;
  }

  ctx.session.flowData!.withdrawalAccount = text;
  ctx.session.step = "confirming_withdrawal";

  const amount = (ctx.session.flowData!.withdrawalAmount! / 100).toFixed(2);
  const method = ctx.session.flowData!.withdrawalMethod === "paypal" ? "PayPal" :
                 ctx.session.flowData!.withdrawalMethod === "bank" ? "Bank Transfer" : "Crypto Wallet";
  const account = ctx.session.flowData!.withdrawalAccount;

  await ctx.reply(
    `💸 Confirm Withdrawal\n\n` +
    `Amount: $${amount}\n` +
    `Method: ${method}\n` +
    `Account: ${account}\n\n` +
    `Please confirm this withdrawal request:`,
    {
      reply_markup: confirmKeyboard("withdraw:confirm", {
        yes: "✅ Confirm",
        no: "❌ Cancel",
      }),
    },
  );
});

// Handle withdrawal confirmation
composer.callbackQuery("withdraw:confirm:yes", async (ctx) => {
  await ctx.answerCallbackQuery();

  const userId = String(ctx.from!.id);
  const wallet = await getWallet(userId);
  const settings = await getSettings();

  if (wallet.balance < ctx.session.flowData!.withdrawalAmount!) {
    await ctx.editMessageText(
      "❌ Withdrawal failed — insufficient balance. Please try again.",
      {
        reply_markup: inlineKeyboard([[inlineButton("⬅️ Back to menu", "menu:main")]]),
      },
    );
    ctx.session.step = "idle";
    ctx.session.flowData = {};
    return;
  }

  // Create withdrawal request
  const withdrawalId = generateWithdrawalId();
  const withdrawal = {
    id: withdrawalId,
    user_id: userId,
    amount: ctx.session.flowData!.withdrawalAmount!,
    method: ctx.session.flowData!.withdrawalMethod!,
    account_details: ctx.session.flowData!.withdrawalAccount!,
    status: "pending" as const,
    created_at: new Date().toISOString(),
  };

  await saveWithdrawal(withdrawal);

  // Deduct from wallet and add to pending
  wallet.balance -= withdrawal.amount;
  wallet.pending_withdrawals += withdrawal.amount;
  await saveWallet(wallet);

  // Reset flow state
  ctx.session.step = "idle";
  ctx.session.flowData = {};

  await ctx.editMessageText(
    `✅ Withdrawal Request Submitted\n\n` +
    `Request ID: ${withdrawalId}\n` +
    `Amount: $${(withdrawal.amount / 100).toFixed(2)}\n\n` +
    `Your request has been submitted for review. You'll be notified once it's processed.`,
    {
      reply_markup: inlineKeyboard([
        [inlineButton("⬅️ Back to menu", "menu:main")],
      ]),
    },
  );

  // Notify admin (if admin chat is configured)
  if (settings.admin_chat_id) {
    try {
      const user = await getUser(userId);
      const adminMessage = [
        "💸 New Withdrawal Request",
        "",
        `User: ${user?.name ?? userId}`,
        `Amount: $${(withdrawal.amount / 100).toFixed(2)}`,
        `Method: ${withdrawal.method}`,
        `Account: ${withdrawal.account_details}`,
        "",
        `Request ID: ${withdrawalId}`,
      ].join("\n");

      await ctx.api.sendMessage(settings.admin_chat_id, adminMessage, {
        reply_markup: inlineKeyboard([
          [inlineButton("Approve", `withdraw:admin:approve:${withdrawalId}`)],
          [inlineButton("Reject", `withdraw:admin:reject:${withdrawalId}`)],
        ]),
      });
    } catch (error) {
      // Admin notification failed — log but don't break the user flow
      console.error("Failed to notify admin:", error);
    }
  }
});

// Handle withdrawal cancellation
composer.callbackQuery("withdraw:confirm:no", async (ctx) => {
  await ctx.answerCallbackQuery();

  ctx.session.step = "idle";
  ctx.session.flowData = {};

  await ctx.editMessageText(
    "❌ Withdrawal cancelled.",
    {
      reply_markup: inlineKeyboard([[inlineButton("⬅️ Back to menu", "menu:main")]]),
    },
  );
});

// Handle general cancel button
composer.callbackQuery("withdraw:cancel", async (ctx) => {
  await ctx.answerCallbackQuery();

  ctx.session.step = "idle";
  ctx.session.flowData = {};

  await ctx.editMessageText(
    "❌ Withdrawal cancelled.",
    {
      reply_markup: inlineKeyboard([[inlineButton("⬅️ Back to menu", "menu:main")]]),
    },
  );
});

export default composer;
