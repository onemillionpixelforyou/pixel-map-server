const express = require('express');
const cors = require('cors');
const fs = require('fs').promises;
const path = require('path');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 10000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Путь к файлу с данными
const DATA_FILE = path.join(__dirname, 'data', 'pixels.json');

// ===== ИНИЦИАЛИЗАЦИЯ ДАННЫХ =====
async function initDataFile() {
    try {
        await fs.access(DATA_FILE);
    } catch (error) {
        await fs.mkdir(path.dirname(DATA_FILE), { recursive: true });
        const initialData = {
            sold: {},
            transactions: [],
            stats: { totalSold: 0, totalEarned: 0 }
        };
        await fs.writeFile(DATA_FILE, JSON.stringify(initialData, null, 2));
        console.log('📁 Создан файл данных');
    }
}

async function loadData() {
    try {
        const data = await fs.readFile(DATA_FILE, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        return { sold: {}, transactions: [], stats: { totalSold: 0, totalEarned: 0 } };
    }
}

async function saveData(data) {
    await fs.writeFile(DATA_FILE, JSON.stringify(data, null, 2));
}

initDataFile();

// ===== API ЭНДПОИНТЫ =====

// Получение всех пикселей
app.get('/api/pixels', async (req, res) => {
    try {
        const data = await loadData();
        res.json({
            sold: data.sold,
            stats: data.stats,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('Error fetching pixels:', error);
        res.status(500).json({ error: 'Ошибка загрузки данных' });
    }
});

// Создание платежа
app.post('/api/create-payment', async (req, res) => {
    try {
        const { blocks, color, image, link, slogan, totalPrice } = req.body;

        console.log('📥 Получен запрос на создание платежа:', { blocks: blocks?.length, totalPrice });

        // Валидация
        if (!blocks || blocks.length === 0) {
            return res.status(400).json({ error: 'Не выбрано ни одного блока' });
        }

        if (!color) {
            return res.status(400).json({ error: 'Не указан цвет' });
        }

        if (totalPrice < 100) {
            return res.status(400).json({ error: 'Минимальная сумма 100 ₽' });
        }

        // Проверяем, не проданы ли уже эти блоки
        const data = await loadData();
        const alreadySold = blocks.filter(id => data.sold[id]);
        if (alreadySold.length > 0) {
            return res.status(400).json({
                error: 'Некоторые блоки уже проданы',
                soldBlocks: alreadySold
            });
        }

        // Создаём транзакцию
        const transactionId = uuidv4();
        const transaction = {
            id: transactionId,
            blocks: blocks,
            color: color,
            image: image || '',
            link: link || '#',
            slogan: slogan || 'Без описания',
            totalPrice: totalPrice,
            status: 'completed', // Сразу активируем для упрощения
            createdAt: new Date().toISOString(),
            completedAt: new Date().toISOString()
        };

        // Сразу активируем блоки
        transaction.blocks.forEach(blockId => {
            data.sold[blockId] = {
                color: transaction.color,
                image: transaction.image,
                link: transaction.link,
                slogan: transaction.slogan,
                purchasedAt: transaction.completedAt,
                transactionId: transaction.id
            };
        });

        data.transactions.push(transaction);
        data.stats.totalSold += transaction.blocks.length * 100;
        data.stats.totalEarned += transaction.totalPrice;

        await saveData(data);

        console.log(`💰 Платёж #${transactionId} на сумму ${totalPrice} ₽ обработан, активировано ${blocks.length} блоков`);

        res.json({
            success: true,
            transactionId: transactionId,
            message: 'Блоки успешно активированы'
        });

    } catch (error) {
        console.error('Error creating payment:', error);
        res.status(500).json({ error: 'Ошибка при создании платежа' });
    }
});

// Health Check для Render
app.get('/healthz', (req, res) => {
    res.status(200).send('OK');
});

// Запуск сервера
app.listen(PORT, () => {
    console.log(`🚀 Pixel Map Server запущен на порту ${PORT}`);
    console.log(`📁 Данные хранятся в ${DATA_FILE}`);
});
