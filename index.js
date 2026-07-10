const { Telegraf } = require('telegraf');

// === НАСТРОЙКИ (ТВОИ ДАННЫЕ) ===
const BOT_TOKEN = '8696927422:AAGe2rDO5uDKY4Ac5B8_EDQvLYYL91ivNns'; 
const MY_TELEGRAM_ID = 6318051388; 

// Эти переменные бот заполнит сам на лету при первом сообщении в нужную тему!
let RP_CHAT_ID = null;
let RP_TOPIC_ID = null;
// ===============================

const bot = new Telegraf(BOT_TOKEN);

bot.on('message', async (ctx) => {
    // 1. НАСТРОЙКА НА ТЕМУ (Сработает, если чат еще не сохранен)
    if (!RP_CHAT_ID) {
        if (ctx.chat.type === 'group' || ctx.chat.type === 'supergroup') {
            // Запоминаем ID группы и ID конкретной темы
            RP_CHAT_ID = ctx.chat.id;
            RP_TOPIC_ID = ctx.message.message_thread_id || 0; 
            
            try {
                // Отправляем тебе сигнал в личку, что тема успешно привязана
                await ctx.telegram.sendMessage(
                    MY_TELEGRAM_ID, 
                    `🎯 **Эмилия успешно привязана к теме!**\n\n` +
                    `• ID чата: \`${RP_CHAT_ID}\`\n` +
                    `• ID темы: \`${RP_TOPIC_ID}\`\n\n` +
                    `Теперь всё, что ты пишешь мне в личку, я буду отправлять туда!`
                );
            } catch (e) {
                console.log('Сначала нажми "Старт" у бота в личных сообщениях!');
            }
            return;
        }
    }

    // 2. РЕЖИМ РП (Пересылка твоих сообщений из лички бота прямо в РП-тему)
    if (ctx.from.id === MY_TELEGRAM_ID && ctx.chat.type === 'private') {
        if (!RP_CHAT_ID) {
            return ctx.reply('⚠️ Сначала зайди в нужную РП-тему группы и напиши туда что-нибудь, чтобы я привязалась к ней!');
        }

        try {
            // Отправляем текст строго в привязанную супергруппу и тему
            await ctx.telegram.sendMessage(RP_CHAT_ID, ctx.message.text, {
                message_thread_id: RP_TOPIC_ID
            });
            // Ставим галочку на твоё сообщение в личке, что всё улетело
            await ctx.react('✅').catch(() => {}); 
        } catch (error) {
            console.error('Ошибка отправки реплики:', error);
            await ctx.reply('❌ Ошибка отправки. Проверь, админ ли я в группе.');
        }
    }
});

bot.launch().then(() => console.log('Эмилия запущена и ждёт привязки к теме...'));

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
