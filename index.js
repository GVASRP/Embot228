const { Telegraf } = require('telegraf');

// === НАСТРОЙКИ ===
const BOT_TOKEN = '8696927422:AAGe2rDO5uDKY4Ac5B8_EDQvLYYL91ivNns'; 
const MY_TELEGRAM_ID = 6318051388; 

// База данных в оперативной памяти (хранит темы и связи сообщений для Reply)
let RP_CHAT_ID = null;
let activeTopicId = null;
const topics = new Map(); // ID темы -> Название темы
const msgMapToChat = new Map(); // ID сообщения в личке -> ID сообщения в группе
const msgMapToLog = new Map();  // ID сообщения в группе -> ID сообщения в личке
// =================

const bot = new Telegraf(BOT_TOKEN);

// Функция для генерации клавиатуры выбора тем
const getTopicsKeyboard = () => {
    if (topics.size === 0) return null;
    const buttons = [];
    for (const [id, name] of topics.entries()) {
        const prefix = Number(id) === Number(activeTopicId) ? '🟢 ' : '⚪ ';
        buttons.push([{ text: `${prefix}${name}`, callback_data: `select_topic:${id}` }]);
    }
    return { inline_keyboard: buttons };
};

// Хэндлер на нажатие кнопок выбора тем
bot.on('callback_query', async (ctx) => {
    if (ctx.from.id !== MY_TELEGRAM_ID) return ctx.answerCbQuery('Доступ закрыт.');
    
    const data = ctx.callbackQuery.data;
    if (data.startsWith('select_topic:')) {
        const topicId = data.split(':')[1];
        activeTopicId = topicId === '0' ? 0 : Number(topicId);
        
        await ctx.answerCbQuery(`Выбрана тема: ${topics.get(activeTopicId)}`);
        await ctx.editMessageText(`Вы переключились на тему: **${topics.get(activeTopicId)}**\nВсе сообщения и медиа отправляются туда.`, {
            parse_mode: 'Markdown',
            reply_markup: getTopicsKeyboard()
        });
    }
});

// Команда /menu в личке, чтобы вызвать список тем вручную
bot.command('menu', async (ctx) => {
    if (ctx.from.id !== MY_TELEGRAM_ID) return;
    if (!RP_CHAT_ID) return ctx.reply('⚠️ Бот еще не привязан к группе. Напишите что-нибудь в РП-темах группы.');
    
    await ctx.reply('Выберите активную тему для отправки сообщений от имени Эмилии:', {
        reply_markup: getTopicsKeyboard()
    });
});

// Основной обработчик всех входящих обновлений
bot.on(['message', 'edited_message'], async (ctx) => {
    const msg = ctx.message || ctx.editedMessage;
    if (!msg) return;

    const isGroup = ctx.chat.type === 'group' || ctx.chat.type === 'supergroup';
    const isPrivate = ctx.chat.type === 'private';

    // === ЛОГИКА 1: ПОЛУЧЕНИЕ ИЗ ГРУППЫ (Сбор тем и трансляция в личку для Reply) ===
    if (isGroup) {
        RP_CHAT_ID = ctx.chat.id;
        const currentTopicId = msg.message_thread_id || 0;
        
        // Автоматически запоминаем имя темы, если она новая
        if (msg.reply_to_message && msg.reply_to_message.forum_topic_created) {
            topics.set(currentTopicId, msg.reply_to_message.forum_topic_created.name);
        } else if (!topics.has(currentTopicId)) {
            topics.set(currentTopicId, `Тема #${currentTopicId || 'Главная'}`);
        }

        if (!activeTopicId && activeTopicId !== 0) activeTopicId = currentTopicId;

        // Если пишет КТО-ТО ДРУГОЙ в активную тему — дублируем тебе в личку, чтобы ты мог ответить
        if (msg.from.id !== MY_TELEGRAM_ID && currentTopicId === activeTopicId) {
            try {
                // Формируем красивую плашку, кто говорит в РП
                const senderName = msg.from.username ? `@${msg.from.username}` : msg.from.first_name;
                const forwardHeader = `💬 **${senderName}** в теме [${topics.get(currentTopicId)}]:\n`;

                let logMsg;
                if (msg.text) {
                    logMsg = await ctx.telegram.sendMessage(MY_TELEGRAM_ID, forwardHeader + msg.text, { parse_mode: 'Markdown' });
                } else {
                    // Если это медиа, шлем сначала заголовок, а потом само медиа
                    await ctx.telegram.sendMessage(MY_TELEGRAM_ID, forwardHeader, { parse_mode: 'Markdown' });
                    logMsg = await ctx.telegram.copyMessage(MY_TELEGRAM_ID, RP_CHAT_ID, msg.message_id);
                }

                // Линкуем сообщения для возможности Reply
                msgMapToLog.set(msg.message_id, logMsg.message_id);
                msgMapToChat.set(logMsg.message_id, msg.message_id);
            } catch (e) {
                console.error('Ошибка логирования в личку:', e);
            }
        }
        return;
    }

    // === ЛОГИКА 2: ОТПРАВКА ИЗ ЛИЧКИ В ГРУППУ ===
    if (isPrivate && msg.from.id === MY_TELEGRAM_ID) {
        if (!RP_CHAT_ID || activeTopicId === null) {
            return ctx.reply('⚠️ Напишите сначала любое сообщение в нужной теме внутри группы, чтобы бот её увидел.');
        }

        // Проверяем, сделан ли Reply (ответ) в личке
        let replyToMessageId = undefined;
        if (msg.reply_to_message) {
            // Ищем, какому сообщению в группе соответствует этот Reply из лички
            const targetGroupId = msgMapToChat.get(msg.reply_to_message.message_id);
            if (targetGroupId) replyToMessageId = targetGroupId;
        }

        try {
            // Опции отправки (привязка к теме + реплай, если есть)
            const extraOptions = {
                message_thread_id: activeTopicId,
                reply_to_message_id: replyToMessageId
            };

            // Копируем ЛЮБОЙ тип сообщения (текст, фото, видео, гифки, стикеры, голосовые)
            const sentMsg = await ctx.telegram.copyMessage(RP_CHAT_ID, MY_TELEGRAM_ID, msg.message_id, extraOptions);
            
            // Запоминаем связь на случай, если тебе ответят
            msgMapToChat.set(msg.message_id, sentMsg.message_id);
            msgMapToLog.set(sentMsg.message_id, msg.message_id);

            await ctx.react('✅').catch(() => {});
        } catch (error) {
            console.error('Ошибка отправки в группу:', error);
            await ctx.reply('❌ Не удалось отправить. Убедитесь, что бот добавлен в группу как админ со всеми правами.');
        }
    }
});

bot.launch().then(() => console.log('Качественный РП-бот запущен!'));

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
