const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// 持久化数据目录：Railway Volume 挂载到 /app/data
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'sync.json');

// 确保数据目录存在
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// 默认空数据结构
const defaultData = {
  version: '1.0',
  words: [],
  errors: [],
  reviews: [],
  practice: [],
  lastModified: new Date().toISOString(),
  device: 'init'
};

// 读取数据（不存在则创建默认值）
function readData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = fs.readFileSync(DATA_FILE, 'utf8');
      return JSON.parse(raw);
    }
  } catch (e) {
    console.error('读取数据失败:', e.message);
  }
  return { ...defaultData };
}

// 写入数据
function writeData(data) {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
    return true;
  } catch (e) {
    console.error('写入数据失败:', e.message);
    return false;
  }
}

// 初始化数据文件
if (!fs.existsSync(DATA_FILE)) {
  writeData(defaultData);
}

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// 获取数据
app.get('/api/data', (req, res) => {
  const data = readData();
  res.json(data);
});

// 保存数据（按时间戳决定是否覆盖）
app.post('/api/data', (req, res) => {
  const incoming = req.body;
  if (!incoming || typeof incoming !== 'object') {
    return res.status(400).json({ ok: false, error: 'Invalid payload' });
  }

  const current = readData();
  const incomingTime = incoming.lastModified ? new Date(incoming.lastModified).getTime() : 0;
  const currentTime = current.lastModified ? new Date(current.lastModified).getTime() : 0;

  // 如果传入数据比云端新，或者云端为空，则覆盖
  if (incomingTime >= currentTime || !current.words || current.words.length === 0) {
    const toSave = {
      version: incoming.version || current.version || '1.0',
      words: incoming.words || current.words || [],
      errors: incoming.errors || current.errors || [],
      reviews: incoming.reviews || current.reviews || [],
      practice: incoming.practice || current.practice || [],
      lastModified: incoming.lastModified || new Date().toISOString(),
      device: incoming.device || current.device || 'unknown'
    };
    if (writeData(toSave)) {
      return res.json({ ok: true, saved: true, lastModified: toSave.lastModified });
    } else {
      return res.status(500).json({ ok: false, error: 'Failed to write data' });
    }
  } else {
    // 云端更新，拒绝覆盖
    return res.json({ ok: true, saved: false, reason: 'cloud-newer', lastModified: current.lastModified });
  }
});

// 健康检查
app.get('/health', (req, res) => {
  const data = readData();
  res.json({ ok: true, wordsCount: (data.words || []).length, lastModified: data.lastModified });
});

app.listen(PORT, () => {
  console.log(`河北公考言语备考台同步服务运行在端口 ${PORT}`);
  console.log(`数据文件: ${DATA_FILE}`);
});
