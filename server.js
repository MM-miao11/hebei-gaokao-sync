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
  // 资料分析
  data_errors: [],
  data_notes: [],
  data_reviews: [],
  // 判断推理
  judge_errors: [],
  judge_notes: [],
  judge_reviews: [],
  // 模考记录
  mock_exams: [],
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
 * - 只有当两边都标记 deleted 时，合并结果才标记 deleted
 * - 两边都 active（未删除）时，保留 lastModified 较新的版本
 * - 只在一边有的项：直接保留
 * 重要：被一端"软删除"后，会被另一端"重新激活"覆盖（防止旧的删除标记永久卡死数据）
 */
function mergeById(local = [], remote = []) {
  const map = new Map();

  const getTime = (item) => {
    if (!item || typeof item !== 'object') return 0;
    const t = item.lastModified || item.updatedAt || item.createdAt || item.nextReview || item.date || 0;
    return new Date(t).getTime() || 0;
  };

  const findById = (arr, id) => (arr || []).find(x => x && x.id === id);

  // 收集所有 id
  const ids = new Set();
  (local || []).forEach(item => { if (item && item.id) ids.add(item.id); });
  (remote || []).forEach(item => { if (item && item.id) ids.add(item.id); });

  ids.forEach(id => {
    const l = findById(local, id);
    const r = findById(remote, id);

    // 两边都存在
    if (l && r) {
      const lDeleted = !!l.deleted;
      const rDeleted = !!r.deleted;

      if (lDeleted && rDeleted) {
        // 两边都标记删除 → 取时间最新的（保留 deleted 状态）
        const winner = getTime(r) >= getTime(l) ? r : l;
        map.set(id, { ...winner, deleted: true });
      } else if (lDeleted && !rDeleted) {
        // 云端删除，但 incoming 重新激活 → 保留 incoming（取消删除）
        map.set(id, r);
      } else if (!lDeleted && rDeleted) {
        // 云端活跃，incoming 删除 → 保留 incoming（标记删除）
        map.set(id, r);
      } else {
        // 两边都活跃 → 取时间最新的
        map.set(id, getTime(r) >= getTime(l) ? r : l);
      }
    } else if (l) {
      // 只在云端
      map.set(id, l);
    } else if (r) {
      // 只在 incoming
      map.set(id, r);
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

// 保存数据
// mode: 'merge'   （默认）双向智能合并，防止任何一端覆盖丢失
// mode: 'replace' 纯上传覆盖：云端直接替换为客户端数据（本地是什么云端就是什么）
app.post('/api/data', (req, res) => {
  const incoming = req.body;
  if (!incoming || typeof incoming !== 'object') {
    return res.status(400).json({ ok: false, error: 'Invalid payload' });
  }

  const mode = incoming.mode || 'merge';
  const current = readData();

  let merged;
  if (mode === 'replace') {
    // 纯上传覆盖：云端直接用本地数据替换（含软删除标记）
    merged = {
      version: incoming.version || '1.0',
      words: incoming.words || [],
      errors: incoming.errors || [],
      reviews: incoming.reviews || [],
      practice: incoming.practice || [],
      data_errors: incoming.data_errors || [],
      data_notes: incoming.data_notes || [],
      data_reviews: incoming.data_reviews || [],
      judge_errors: incoming.judge_errors || [],
      judge_notes: incoming.judge_notes || [],
      judge_reviews: incoming.judge_reviews || [],
      mock_exams: incoming.mock_exams || [],
      lastModified: new Date().toISOString(),
      device: incoming.device || 'unknown'
    };
  } else {
    // 合并模式（默认，保留旧行为兼容）
    merged = {
      version: incoming.version || current.version || '1.0',
      words: mergeById(current.words, incoming.words),
      errors: mergeById(current.errors, incoming.errors),
      reviews: mergeById(current.reviews, incoming.reviews),
      practice: mergeById(current.practice, incoming.practice),
      data_errors: mergeById(current.data_errors, incoming.data_errors),
      data_notes: mergeById(current.data_notes, incoming.data_notes),
      data_reviews: mergeById(current.data_reviews, incoming.data_reviews),
      judge_errors: mergeById(current.judge_errors, incoming.judge_errors),
      judge_notes: mergeById(current.judge_notes, incoming.judge_notes),
      judge_reviews: mergeById(current.judge_reviews, incoming.judge_reviews),
      mock_exams: mergeById(current.mock_exams, incoming.mock_exams),
      lastModified: new Date().toISOString(),
      device: incoming.device || current.device || 'unknown'
    };
  }

  // 记录合并摘要（统计活跃数据，排除已删除）
  const countActive = (arr) => (arr || []).filter(x => !x.deleted).length;
  const summary = {
    wordsBefore: countActive(current.words),
    wordsAfter: countActive(merged.words),
    wordsIncoming: countActive(incoming.words),
    errorsBefore: countActive(current.errors),
    errorsAfter: countActive(merged.errors),
    errorsIncoming: countActive(incoming.errors)
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
  const activeWords = (data.words || []).filter(w => !w.deleted);
  res.json({ ok: true, wordsCount: activeWords.length, lastModified: data.lastModified });
});

app.listen(PORT, () => {
  console.log(`河北公考言语备考台同步服务运行在端口 ${PORT}`);
  console.log(`数据文件: ${DATA_FILE}`);
});
