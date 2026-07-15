import { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits, REST, Routes } from 'discord.js';
import Datastore from 'nedb-promises';

const db = Datastore.create({ filename: 'giveaways.db', autoload: true });

export const data = new SlashCommandBuilder()
    .setName('mp')
    .setDescription('Управление розыгрышами с кнопками')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageEvents)
    .addSubcommand(subcommand =>
        subcommand
            .setName('create')
            .setDescription('Создать новый розыгрыш')
            .addStringOption(option => 
                option.setName('prize')
                    .setDescription('Что вы разыгрываете? (например: 50кк)')
                    .setRequired(true)
            )
    )
    .addSubcommand(subcommand =>
        subcommand
            .setName('finish')
            .setDescription('Завершить розыгрыш и выбрать победителя')
            .addStringOption(option => 
                option.setName('id')
                    .setDescription('ID сообщения розыгрыша')
                    .setRequired(true)
            )
    );

// --- АВТОМАТИЧЕСКАЯ РЕГИСТРАЦИЯ КОМАНДЫ ПРИ ЗАПУСКЕ ---
setTimeout(async () => {
    try {
        // Берем токен из переменных окружения хостинга Railway
        const token = process.env.TOKEN || process.env.DISCORD_TOKEN;
        if (!token) return console.log('⚠️ [MP-Регистратор] Токен не найден в process.env. Регистрация пропущена.');

        const rest = new REST({ version: '10' }).setToken(token);
        
        // Чтобы узнать ID бота, нам нужно временно декодировать его из токена
        const botId = Buffer.from(token.split('.')[0], 'base64').toString('utf-8');

        console.log('🔄 [MP-Регистратор] Синхронизация команды /mp в Discord...');
        
        await rest.put(
            Routes.applicationCommands(botId),
            { body: [data.toJSON()] }
        );
        
        console.log('✅ [MP-Регистратор] Команда /mp успешно добавлена глобально!');
    } catch (error) {
        console.error('❌ [MP-Регистратор] Ошибка регистрации:', error);
    }
}, 5000); // Запуск через 5 секунд после старта бота, чтобы он успел прогрузиться

export async function execute(interaction) {
    const subcommand = interaction.options.getSubcommand();

    if (subcommand === 'create') {
        const prize = interaction.options.getString('prize');
        const embed = new EmbedBuilder()
            .setTitle('🎉 НОВЫЙ РОЗЫГРЫШ 🎉')
            .setDescription(`🎁 **Приз:** ${prize}\n🏆 **Победители:** По окончании\n👤 **Участники:** 0`)
            .setColor('#FFD700');

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('join_gw').setLabel('🎉 Участвовать').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId('leave_gw').setLabel('❌ Выйти').setStyle(ButtonStyle.Danger)
        );

        const giveawayMessage = await interaction.reply({ embeds: [embed], components: [row], fetchReply: true });
        const updatedEmbed = EmbedBuilder.from(embed).setFooter({ text: `ID розыгрыша: ${giveawayMessage.id}` });
        await giveawayMessage.edit({ embeds: [updatedEmbed] });

        await db.insert({ messageId: giveawayMessage.id, channelId: interaction.channel.id, prize, users: [], ended: false });
    }

    if (subcommand === 'finish') {
        const targetId = interaction.options.getString('id');
        const giveaway = await db.findOne({ messageId: targetId });
        if (!giveaway) return interaction.reply({ content: '❌ Розыгрыш не найден в базе данных.', ephemeral: true });
        if (giveaway.ended) return interaction.reply({ content: '❌ Розыгрыш уже завершен.', ephemeral: true });

        try {
            const channel = await interaction.client.channels.fetch(giveaway.channelId);
            const gwMessage = await channel.messages.fetch(giveaway.messageId);

            if (giveaway.users.length === 0) {
                const endedEmbed = EmbedBuilder.from(gwMessage.embeds).setDescription(`🎁 **Приз:** ${giveaway.prize}\n🏆 **Победители:** Никто не участвовал\n👤 **Участники:** 0`).setColor('#FF0000');
                await gwMessage.edit({ embeds: [endedEmbed], components: [] });
                await db.update({ messageId: targetId }, { $set: { ended: true } });
                return interaction.reply({ content: '🛑 Розыгрыш завершен, но участников не было.', ephemeral: true });
            }

            const winnerId = giveaway.users[Math.floor(Math.random() * giveaway.users.length)];
            const endedEmbed = EmbedBuilder.from(gwMessage.embeds).setDescription(`🎁 **Приз:** ${giveaway.prize}\n🏆 **Победитель:** <@${winnerId}>\n👤 **Участники:** ${giveaway.users.length}`).setColor('#00FF00');

            await gwMessage.edit({ embeds: [endedEmbed], components: [] });
            await db.update({ messageId: targetId }, { $set: { ended: true } });

            await channel.send(`🎉 Поздравляем <@${winnerId}>! Вы выиграли **${giveaway.prize}**!`);
            await interaction.reply({ content: '✅ Итоги успешно подведены!', ephemeral: true });
        } catch (error) {
            interaction.reply({ content: '❌ Не удалось завершить розыгрыш.', ephemeral: true });
        }
    }
}

export async function handleButtons(interaction) {
    if (!interaction.isButton()) return;
    const giveaway = await db.findOne({ messageId: interaction.message.id });
    if (!giveaway || giveaway.ended) return;

    const userId = interaction.user.id;

    if (interaction.customId === 'join_gw') {
        if (giveaway.users.includes(userId)) return interaction.reply({ content: '❌ Вы уже участвуете!', ephemeral: true });
        await db.update({ messageId: interaction.message.id }, { $push: { users: userId } });
        giveaway.users.push(userId);
        await interaction.reply({ content: '✅ Вы успешно записались на розыгрыш!', ephemeral: true });
    } else if (interaction.customId === 'leave_gw') {
        if (!giveaway.users.includes(userId)) return interaction.reply({ content: '❌ Вы и так не участвуете.', ephemeral: true });
        await db.update({ messageId: interaction.message.id }, { $pull: { users: userId } });
        giveaway.users = giveaway.users.filter(id => id !== userId);
        await interaction.reply({ content: '❌ Вы успешно вышли из розыгрыша.', ephemeral: true });
    }

    const updatedEmbed = EmbedBuilder.from(interaction.message.embeds).setDescription(`🎁 **Приз:** ${giveaway.prize}\n🏆 **Победители:** По окончании\n👤 **Участники:** ${giveaway.users.length}`);
    await interaction.message.edit({ embeds: [updatedEmbed] });
            }
    
