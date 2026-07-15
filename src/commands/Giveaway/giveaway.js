import { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits } from 'discord.js';
import { execSync } from 'child_process';

// Скрипт автоматического скачивания базы данных в обход строгого инсталлятора Railway
try {
    await import('nedb-promises');
} catch {
    console.log('📦 [MP-Система] Установка базы данных в реальном времени...');
    execSync('npm install nedb-promises --no-save');
    console.log('✅ [MP-Система] База данных успешно установлена!');
}

const Datastore = (await import('nedb-promises')).default;
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

export async function execute(interaction) {
    // Перехват кнопок прямо внутри команды
    if (interaction.isButton()) {
        const giveaway = await db.findOne({ messageId: interaction.message.id });
        if (!giveaway || giveaway.ended) return;

        const userId = interaction.user.id;

        if (interaction.customId === 'join_gw') {
            if (giveaway.users.includes(userId)) {
                return interaction.reply({ content: '❌ Вы уже участвуете!', ephemeral: true });
            }
            await db.update({ messageId: interaction.message.id }, { $push: { users: userId } });
            giveaway.users.push(userId);
            await interaction.reply({ content: '✅ Вы успешно записались на розыгрыш!', ephemeral: true });
        } 
        else if (interaction.customId === 'leave_gw') {
            if (!giveaway.users.includes(userId)) {
                return interaction.reply({ content: '❌ Вы и так не участвуете.', ephemeral: true });
            }
            await db.update({ messageId: interaction.message.id }, { $pull: { users: userId } });
            giveaway.users = giveaway.users.filter(id => id !== userId);
            await interaction.reply({ content: '❌ Вы успешно вышли из розыгрыша.', ephemeral: true });
        }

        const updatedEmbed = EmbedBuilder.from(interaction.message.embeds)
            .setDescription(`🎁 **Приз:** ${giveaway.prize}\n🏆 **Победители:** По окончании\n👤 **Участники:** ${giveaway.users.length}`);

        return await interaction.message.edit({ embeds: [updatedEmbed] });
    }

    // Обработка слеш-команды
    if (interaction.isChatInputCommand()) {
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
            if (!giveaway || giveaway.ended) return interaction.reply({ content: '❌ Розыгрыш не найден или уже завершен.', ephemeral: true });

            try {
                const channel = await interaction.client.channels.fetch(giveaway.channelId);
                const gwMessage = await channel.messages.fetch(giveaway.messageId);

                if (giveaway.users.length === 0) {
                    const endedEmbed = EmbedBuilder.from(gwMessage.embeds).setDescription(`🎁 **Приз:** ${giveaway.prize}\n🏆 **Победители:** Никто не участвовал\n👤 **Участники:** 0`).setColor('#FF0000');
                    await gwMessage.edit({ embeds: [endedEmbed], components: [] });
                    await db.update({ messageId: targetId }, { $set: { ended: true } });
                    return interaction.reply({ content: '🛑 Участников не было.', ephemeral: true });
                }

                const winnerId = giveaway.users[Math.floor(Math.random() * giveaway.users.length)];
                const endedEmbed = EmbedBuilder.from(gwMessage.embeds).setDescription(`🎁 **Приз:** ${giveaway.prize}\n🏆 **Победитель:** <@${winnerId}>\n👤 **Участники:** ${giveaway.users.length}`).setColor('#00FF00');

                await gwMessage.edit({ embeds: [endedEmbed], components: [] });
                await db.update({ messageId: targetId }, { $set: { ended: true } });

                await channel.send(`🎉 Поздравляем <@${winnerId}>! Вы выиграли **${giveaway.prize}**!`);
                await interaction.reply({ content: '✅ Итоги успешно подведены!', ephemeral: true });
            } catch (error) {
                interaction.reply({ content: '❌ Ошибка подведения итогов.', ephemeral: true });
            }
        }
    }
                }
                
