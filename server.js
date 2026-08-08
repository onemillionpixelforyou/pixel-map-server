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
        res.json(data.sold);
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
            status: 'pending',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };

        data.transactions.push(transaction);
        await saveData(data);

        console.log(`💰 Создан платеж #${transactionId} на сумму ${totalPrice} ₽`);

        // Формируем URL для возврата
        const baseUrl = `${req.protocol}://${req.get('host')}`;
        const returnUrl = `${baseUrl}/api/payment/callback?transaction=${transactionId}`;

        // Ссылка на DonationAlerts
        const donationAlertsUrl = 'https://www.donationalerts.com/payment';
        const paymentUrl = `${donationAlertsUrl}?amount=${totalPrice}&currency=RUB&message=Покупка%20${blocks.length}%20блоков%20на%20Pixel%20Map&return_url=${encodeURIComponent(returnUrl)}`;

        res.json({
            success: true,
            transactionId: transactionId,
            paymentUrl: paymentUrl,
            returnUrl: returnUrl
        });

    } catch (error) {
        console.error('Error creating payment:', error);
        res.status(500).json({ error: 'Ошибка при создании платежа' });
    }
});

// Колбэк после оплаты
app.get('/api/payment/callback', async (req, res) => {
    try {
        const { transaction, payment_id, status } = req.query;

        if (!transaction) {
            return res.status(400).send('Missing transaction ID');
        }

        console.log(`📨 Получен callback для #${transaction}, payment_id: ${payment_id}, status: ${status}`);

        const data = await loadData();
        const txIndex = data.transactions.findIndex(t => t.id === transaction);

        if (txIndex === -1) {
            console.error(`❌ Транзакция #${transaction} не найдена`);
            return res.status(404).send('Transaction not found');
        }

        const tx = data.transactions[txIndex];

        if (tx.status === 'completed') {
            return res.redirect(`/?payment=already_completed&transaction=${transaction}`);
        }

        // В реальном проекте здесь должна быть верификация через API DonationAlerts
        // Сейчас упрощённая версия - считаем успешным
        const isVerified = true;

        if (isVerified) {
            tx.status = 'completed';
            tx.paymentId = payment_id || 'test_payment';
            tx.completedAt = new Date().toISOString();
            tx.updatedAt = new Date().toISOString();

            // Сохраняем блоки
            tx.blocks.forEach(blockId => {
                data.sold[blockId] = {
                    color: tx.color,
                    image: tx.image,
                    link: tx.link,
                    slogan: tx.slogan,
                    purchasedAt: tx.completedAt,
                    transactionId: tx.id
                };
            });

            // Обновляем статистику
            data.stats.totalSold += tx.blocks.length * 100;
            data.stats.totalEarned += tx.totalPrice;

            await saveData(data);

            console.log(`✅ Транзакция #${transaction} завершена успешно! Активировано ${tx.blocks.length} блоков`);

            return res.redirect(`/?payment=success&transaction=${transaction}`);
        } else {
            tx.status = 'failed';
            tx.updatedAt = new Date().toISOString();
            await saveData(data);

            console.log(`❌ Транзакция #${transaction} не подтверждена`);

            return res.redirect(`/?payment=failed&transaction=${transaction}`);
        }

    } catch (error) {
        console.error('Error in payment callback:', error);
        res.status(500).send('Internal server error');
    }
});

// Получение статуса транзакции
app.get('/api/transaction/:id', async (req, res) => {
    try {
        const data = await loadData();
        const tx = data.transactions.find(t => t.id === req.params.id);
        if (!tx) {
            return res.status(404).json({ error: 'Transaction not found' });
        }
        res.json({
            id: tx.id,
            status: tx.status,
            blocks: tx.blocks,
            totalPrice: tx.totalPrice,
            createdAt: tx.createdAt,
            completedAt: tx.completedAt || null
        });
    } catch (error) {
        console.error('Error fetching transaction:', error);
        res.status(500).json({ error: 'Ошибка загрузки транзакции' });
    }
});

// Webhook для DonationAlerts
app.post('/api/webhook/donationalerts', async (req, res) => {
    try {
        const webhookData = req.body;
        console.log('📨 Получен webhook:', webhookData);
        res.status(200).json({ success: true });
    } catch (error) {
        console.error('Webhook error:', error);
        res.status(500).json({ error: 'Webhook processing error' });
    }
});

// Запуск сервера
app.listen(PORT, () => {
    console.log(`🚀 Pixel Map Server запущен на порту ${PORT}`);
    console.log(`📁 Данные хранятся в ${DATA_FILE}`);
    console.log(`💡 Для работы с DonationAlerts настройте .env файл`);
});
