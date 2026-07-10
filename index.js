const { Telegraf } = require('telegraf');

// === НАСТРОЙКИ ===
const BOT_TOKEN = '8696927422:AAGe2rDO5uDKY4Ac5B8_EDQvLYYL91ivNns'; 
const MY_TELEGRAM_ID = 6318051388; // Твой ID (можно узнать в @userinfobot)
const RP_CHAT_ID = -1001234567890; // ID вашего РП-чата (с -100 в начале)
// =================

const bot = new Telegraf(BOT_TOKEN);

bot.on('text', async (ctx) => {
    // Проверяем, что пишешь именно ты
    if (ctx.from.id !== MY_TELEGRAM_ID) return;

    try {
        // Бот пересылает текст в РП-чат от своего имени
        await ctx.telegram.sendMessage(RP_CHAT_ID, ctx.message.text);
        // Тихонько подмигнет тебе в личку, что все ок
        await ctx.react('✅').catch(() => {}); 
    } catch (error) {
        console.error('Ошибка:', error);
    }
});

bot.launch().then(() => console.log('Эмилия готова к РП!'));

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
