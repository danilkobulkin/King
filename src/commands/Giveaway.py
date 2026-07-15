import discord
from discord.ext import commands
from discord import app_commands

# Хранилище участников в памяти (для теста)
giveaway_participants = {}

class GiveawayView(discord.ui.View):
    def __init__(self, prize: str, winners_count: int, organizer_id: int):
        super().__init__(timeout=None) # Кнопки работают постоянно
        self.prize = prize
        self.winners_count = winners_count
        self.organizer_id = organizer_id

    def update_embed(self, participants_count: int) -> discord.Embed:
        """Создает и обновляет карточку розыгрыша"""
        embed = discord.Embed(
            title="🎉 РОЗЫГРЫШ 🎉", 
            color=discord.Color.orange()
        )
        embed.add_field(name="🎁 Приз", value=f"{self.prize}", inline=False)
        embed.add_field(name="🏆 Победителей", value=f"{self.winners_count}", inline=False)
        embed.add_field(name="👥 Участников", value=f"{participants_count}", inline=False)
        embed.add_field(name="🎯 Организатор", value=f"<@{self.organizer_id}>", inline=False)
        embed.set_footer(text="Нажмите кнопку чтобы участвовать!")
        return embed

    @discord.ui.button(label="Участвовать", style=discord.ButtonStyle.success, custom_id="gw_join", emoji="🎉")
    async def join_button(self, interaction: discord.Interaction, button: discord.ui.Button):
        msg_id = interaction.message.id
        user_id = interaction.user.id

        if msg_id not in giveaway_participants:
            giveaway_participants[msg_id] = set()

        if user_id in giveaway_participants[msg_id]:
            await interaction.response.send_message("Вы уже участвуете в этом розыгрыше!", ephemeral=True)
            return

        # Добавляем игрока в список и обновляем цифру участников в реальном времени
        giveaway_participants[msg_id].add(user_id)
        count = len(giveaway_participants[msg_id])
        
        await interaction.message.edit(embed=self.update_embed(count))
        await interaction.response.send_message("Вы успешно зарегистрировались!", ephemeral=True)

    @discord.ui.button(label="Выйти", style=discord.ButtonStyle.danger, custom_id="gw_leave", emoji="❌")
    async def leave_button(self, interaction: discord.Interaction, button: discord.ui.Button):
        msg_id = interaction.message.id
        user_id = interaction.user.id

        if msg_id not in giveaway_participants or user_id not in giveaway_participants[msg_id]:
            await interaction.response.send_message("Вы не участвуете в этом розыгрыше.", ephemeral=True)
            return

        # Удаляем игрока и обновляем эмбед
        giveaway_participants[msg_id].remove(user_id)
        count = len(giveaway_participants[msg_id])
        
        await interaction.message.edit(embed=self.update_embed(count))
        await interaction.response.send_message("Вы вышли из розыгрыша.", ephemeral=True)


class Bot(commands.Bot):
    def __init__(self):
        intents = discord.Intents.default()
        super().__init__(command_prefix="!", intents=intents)

    async def on_ready(self):
        print(f"Бот {self.user} запущен!")
        await self.tree.sync() # Обязательно для регистрации слэш-команд в Discord

bot = Bot()

# Настраиваем полностью русскую команду
@bot.tree.command(name="розыгрыш", description="Запустить новый розыгрыш")
@app_commands.describe(
    приз="Что разыгрывается? (например: 50.000 💎)", 
    победители="Сколько будет победителей? (число)"
)
async def giveaway(interaction: discord.Interaction, приз: str, победители: int = 1):
    # Передаем введенные параметры в конструктор кнопок
    view = GiveawayView(prize=приз, winners_count=победители, organizer_id=interaction.user.id)
    
    # Стартовый эмбед (0 участников)
    embed = view.update_embed(0)
    
    # Отправляем сообщение с карточкой и кнопками
    await interaction.response.send_message(embed=embed, view=view)

bot.run("MTUyNjYyNzYxNzQ2MDA2MDMyMQ.GJxK1S.x17F_DcVu7j0vctbN-E_WErPHySKIGkVcqxFjo")
      
