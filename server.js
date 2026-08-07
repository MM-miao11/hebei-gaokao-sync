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

/**
 * 按 id 智能合并两个数组
 * - 以 id 为唯一标识
 * - 两边都有的项：保留 lastModified / updatedAt / createdAt 较新的版本
 * - 只在一边有的项：直接保留
 */
function mergeById(local = [], remote = []) {
  const map = new Map();

  const getTime = (item) => {
    if (!item || typeof item !== 'object') return 0;
    const t = item.lastModified || item.updatedAt || item.createdAt || item.nextReview || item.date || 0;
    return new Date(t).getTime() || 0;
  };

  [...local, ...remote].forEach(item => {
    if (!item || typeof item !== 'object') return;
    const id = item.id;
    if (!id) return;

    const existing = map.get(id);
    if (!existing || getTime(item) >= getTime(existing)) {
      map.set(id, item);
    }
  });

  return Array.from(map.values());
}

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// 获取数据
app.get('/api/data', (req, res) => {
  const data = readData();
  res.json(data);
});

// 保存数据（后端智能合并，防止任何客户端覆盖丢失）
app.post('/api/data', (req, res) => {
  const incoming = req.body;
  if (!incoming || typeof incoming !== 'object') {
    return res.status(400).json({ ok: false, error: 'Invalid payload' });
  }

  const current = readData();

  // 按 ID 合并四类数据
  const merged = {
    version: incoming.version || current.version || '1.0',
    words: mergeById(current.words, incoming.words),
    errors: mergeById(current.errors, incoming.errors),
    reviews: mergeById(current.reviews, incoming.reviews),
    practice: mergeById(current.practice, incoming.practice),
    lastModified: new Date().toISOString(),
    device: incoming.device || current.device || 'unknown'
  };

  // 记录合并摘要
  const summary = {
    wordsBefore: (current.words || []).length,
    wordsAfter: merged.words.length,
    wordsIncoming: (incoming.words || []).length,
    errorsBefore: (current.errors || []).length,
    errorsAfter: merged.errors.length,
    errorsIncoming: (incoming.errors || []).length
  };

  if (writeData(merged)) {
    return res.json({
      ok: true,
      saved: true,
      lastModified: merged.lastModified,
      summary: summary
    });
  } else {
    return res.status(500).json({ ok: false, error: 'Failed to write data' });
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
