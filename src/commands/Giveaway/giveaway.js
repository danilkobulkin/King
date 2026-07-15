import { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits } from 'discord.js';
import Datastore from 'nedb-promises';

// База данных автоматически создается на хостинге Railway
const db = Datastore.create({ filename: 'giveaways.db', autoload: true });

export const data = new SlashCommandBuilder()
    .setName('mp') // Название команды в Discord: /mp
    .setDescription('Управление розыгрышами с кнопками')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageEvents) // Только для тех, у кого есть право "Управление событиями"
    .addSubcommand(subcommand =>
        subcommand
            .setName('create') // Субкоманда: /mp create
            .setDescription('Создать новый розыгрыш')
            .addStringOption(option => 
                option.setName('prize') // Опция приза: /mp create prize: 50кк
                    .setDescription('Что вы разыгрываете? (например: 50кк)')
                    .setRequired(true)
            )
    )
    .addSubcommand(subcommand =>
        subcommand
            .setName('finish') // Субкоманда: /mp finish
            .setDescription('Завершить розыгрыш и выбрать победителя')
            .addStringOption(option => 
                option.setName('id') // Опция ID: /mp finish id: 123456789
                    .setDescription('ID сообщения розыгрыша (указан внизу эмбеда)')
                    .setRequired(true)
            )
    );

export async function execute(interaction) {
    const subcommand = interaction.options.getSubcommand();

    // --- ЛОГИКА СОЗДАНИЯ РОЗЫГРЫША (/mp create) ---
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

        // Отправляем сообщение
        const giveawayMessage = await interaction.reply({ embeds: [embed], components: [row], fetchReply: true });

        // Автоматически добавляем ID сообщения в футер, чтобы его было легко скопировать для завершения
        const updatedEmbed = EmbedBuilder.from(embed).setFooter({ text: `ID розыгрыша: ${giveawayMessage.id}` });
        await giveawayMessage.edit({ embeds: [updatedEmbed] });

        // Записываем данные в базу NeDB
        await db.insert({
            messageId: giveawayMessage.id,
            channelId: interaction.channel.id,
            prize: prize,
            users: [],
            ended: false
        });
    }

    // --- ЛОГИКА ЗАВЕРШЕНИЯ РОЗЫГРЫША (/mp finish) ---
    if (subcommand === 'finish') {
        const targetId = interaction.options.getString('id');

        const giveaway = await db.findOne({ messageId: targetId });
        if (!giveaway) return interaction.reply({ content: '❌ Розыгрыш с таким ID не найден в базе данных.', ephemeral: true });
        if (giveaway.ended) return interaction.reply({ content: '❌ Этот розыгрыш уже был завершен.', ephemeral: true });

        try {
            const channel = await interaction.client.channels.fetch(giveaway.channelId);
            const gwMessage = await channel.messages.fetch(giveaway.messageId);

            // Если никто не нажал на кнопку
            if (giveaway.users.length === 0) {
                const endedEmbed = EmbedBuilder.from(gwMessage.embeds)
                    .setDescription(`🎁 **Приз:** ${giveaway.prize}\n🏆 **Победители:** Никто не участвовал\n👤 **Участники:** 0`)
                    .setColor('#FF0000');
                
                await gwMessage.edit({ embeds: [endedEmbed], components: [] });
                await db.update({ messageId: targetId }, { $set: { ended: true } });
                return interaction.reply({ content: '🛑 Розыгрыш завершен, но участников не было.', ephemeral: true });
            }

            // Выбираем случайного победителя из массива участников
            const winnerId = giveaway.users[Math.floor(Math.random() * giveaway.users.length)];

            const endedEmbed = EmbedBuilder.from(gwMessage.embeds)
                .setDescription(`🎁 **Приз:** ${giveaway.prize}\n🏆 **Победитель:** <@${winnerId}>\n👤 **Участники:** ${giveaway.users.length}`)
                .setColor('#00FF00');

            // Убираем кнопки и красим эмбед в зеленый цвет
            await gwMessage.edit({ embeds: [endedEmbed], components: [] });
            await db.update({ messageId: targetId }, { $set: { ended: true } });

            // Объявляем победителя в чат с упоминанием
            await channel.send(`🎉 Поздравляем <@${winnerId}>! Вы выиграли **${giveaway.prize}**!`);
            await interaction.reply({ content: '✅ Итоги успешно подведены!', ephemeral: true });

        } catch (error) {
            interaction.reply({ content: '❌ Не удалось завершить розыгрыш. Возможно, канал или сообщение были удалены.', ephemeral: true });
        }
    }
}

// --- ЛОГИКА НАЖАТИЯ НА КНОПКИ (ВЗАИМОДЕЙСТВИЕ) ---
export async function handleButtons(interaction) {
    if (!interaction.isButton()) return;

    const giveaway = await db.findOne({ messageId: interaction.message.id });
    if (!giveaway) return; // Игнорируем кнопки, которые не относятся к системе розыгрышей
    if (giveaway.ended) {
        return interaction.reply({ content: '❌ Этот розыгрыш уже завершен!', ephemeral: true });
    }

    const userId = interaction.user.id;

    // Нажата кнопка "Участвовать"
    if (interaction.customId === 'join_gw') {
        if (giveaway.users.includes(userId)) {
            return interaction.reply({ content: '❌ Вы уже участвуете в этом розыгрыше!', ephemeral: true });
        }
        await db.update({ messageId: interaction.message.id }, { $push: { users: userId } });
        giveaway.users.push(userId);
        await interaction.reply({ content: '✅ Вы успешно записались на розыгрыш!', ephemeral: true });
    } 
    
    // Нажата кнопка "Выйти"
    else if (interaction.customId === 'leave_gw') {
        if (!giveaway.users.includes(userId)) {
            return interaction.reply({ content: '❌ Вы и так не участвуете в этом розыгрыше.', ephemeral: true });
        }
        await db.update({ messageId: interaction.message.id }, { $pull: { users: userId } });
        giveaway.users = giveaway.users.filter(id => id !== userId);
        await interaction.reply({ content: '❌ Вы успешно вышли из розыгрыша.', ephemeral: true });
    }

    // Динамически обновляем цифру участников в эмбеде в реальном времени
    const updatedEmbed = EmbedBuilder.from(interaction.message.embeds)
        .setDescription(`🎁 **Приз:** ${giveaway.prize}\n🏆 **Победители:** По окончании\n👤 **Участники:** ${giveaway.users.length}`);

    await interaction.message.edit({ embeds: [updatedEmbed] });
            }
                          
