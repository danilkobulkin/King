const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits } = require('discord.js');
const Datastore = require('nedb-promises');

// База данных создается автоматически прямо на хостинге Railway
const db = Datastore.create({ filename: 'giveaways.db', autoload: true });

module.exports = {
    data: new SlashCommandBuilder()
        .setName('розыгрыш')
        .setDescription('Управление розыгрышами')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageEvents) // Только для администраторов / менеджеров
        .addSubcommand(subcommand =>
            subcommand
                .setName('создать')
                .setDescription('Создать новый розыгрыш')
                .addStringOption(option => 
                    option.setName('приз')
                        .setDescription('Что вы разыгрываете? (например: 50.000₽)')
                        .setRequired(true)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('финиш')
                .setDescription('Завершить розыгрыш и выбрать победителя')
                .addStringOption(option => 
                    option.setName('id')
                        .setDescription('ID сообщения розыгрыша (указан внизу эмбеда)')
                        .setRequired(true)
                )
        ),

    async execute(interaction) {
        const subcommand = interaction.options.getSubcommand();

        // --- СУБКОМАНДА: СОЗДАТЬ ---
        if (subcommand === 'создать') {
            const prize = interaction.options.getString('приз');

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

            await db.insert({
                messageId: giveawayMessage.id,
                channelId: interaction.channel.id,
                prize: prize,
                users: [],
                ended: false
            });
        }

        // --- СУБКОМАНДА: ФИНИШ ---
        if (subcommand === 'финиш') {
            const targetId = interaction.options.getString('id');

            const giveaway = await db.findOne({ messageId: targetId });
            if (!giveaway) return interaction.reply({ content: '❌ Розыгрыш с таким ID не найден.', ephemeral: true });
            if (giveaway.ended) return interaction.reply({ content: '❌ Этот розыгрыш уже завершен.', ephemeral: true });

            try {
                const channel = await interaction.client.channels.fetch(giveaway.channelId);
                const gwMessage = await channel.messages.fetch(giveaway.messageId);

                if (giveaway.users.length === 0) {
                    const endedEmbed = EmbedBuilder.from(gwMessage.embeds)
                        .setDescription(`🎁 **Приз:** ${giveaway.prize}\n🏆 **Победители:** Никто не участвовал\n👤 **Участники:** 0`)
                        .setColor('#FF0000');
                    
                    await gwMessage.edit({ embeds: [endedEmbed], components: [] });
                    await db.update({ messageId: targetId }, { $set: { ended: true } });
                    return interaction.reply({ content: '🛑 Розыгрыш завершен, но участников не было.', ephemeral: true });
                }

                const winnerId = giveaway.users[Math.floor(Math.random() * giveaway.users.length)];

                const endedEmbed = EmbedBuilder.from(gwMessage.embeds)
                    .setDescription(`🎁 **Приз:** ${giveaway.prize}\n🏆 **Победитель:** <@${winnerId}>\n👤 **Участники:** ${giveaway.users.length}`)
                    .setColor('#00FF00');

                await gwMessage.edit({ embeds: [endedEmbed], components: [] });
                await db.update({ messageId: targetId }, { $set: { ended: true } });

                await channel.send(`🎉 Поздравляем <@${winnerId}>! Вы выиграли **${giveaway.prize}**!`);
                await interaction.reply({ content: '✅ Итоги успешно подведены!', ephemeral: true });

            } catch (error) {
                interaction.reply({ content: '❌ Не удалось завершить розыгрыш. Возможно, он был удален.', ephemeral: true });
            }
        }
    },

    // Логика кнопок
    async handleButtons(interaction) {
        if (!interaction.isButton()) return;

        const giveaway = await db.findOne({ messageId: interaction.message.id });
        if (!giveaway) return; // Игнорируем кнопки других систем бота
        if (giveaway.ended) {
            return interaction.reply({ content: '❌ Этот розыгрыш уже завершен!', ephemeral: true });
        }

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

        await interaction.message.edit({ embeds: [updatedEmbed] });
    }
};

