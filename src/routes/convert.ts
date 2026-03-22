import { Hono } from 'hono';

// Simple simplified/traditional Chinese character mapping
// This is a simplified version - production should use OpenCC library

const TRADITIONAL_TO_SIMPLIFIED: Record<string, string> = {
  '詩': '诗', '詞': '词', '語': '语', '書': '书', '華': '华',
  '國': '国', '時': '时', '間': '间', '為': '为', '學': '学',
  '們': '们', '這': '这', '那': '那', '來': '来', '去': '去',
  '見': '见', '聞': '闻', '說': '说', '話': '话', '認': '认',
  '讓': '让', '過': '过', '還': '还', '動': '动', '樣': '样',
  '機': '机', '關': '关', '門': '门', '間': '间', '題': '题',
  '電': '电', '網': '网', '雲': '云', '龍': '龙', '風': '风',
  '魚': '鱼', '鳥': '鸟', '馬': '马', '車': '车', '錢': '钱',
  '長': '长', '短': '短', '高': '高', '低': '低', '遠': '远',
  '近': '近', '大': '大', '小': '小', '多': '多', '少': '少',
  '新': '新', '舊': '旧', '好': '好', '壞': '坏', '美': '美',
  '麗': '丽', '天': '天', '地': '地', '人': '人', '心': '心',
  '意': '意', '情': '情', '思': '思', '念': '念', '愛': '爱',
  '恨': '恨', '生': '生', '死': '死', '年': '年', '月': '月',
  '日': '日', '時': '时', '春': '春', '夏': '夏', '秋': '秋',
  '冬': '冬', '山': '山', '水': '水', '江': '江', '河': '河',
  '湖': '湖', '海': '海', '東': '东', '西': '西', '南': '南',
  '北': '北', '左': '左', '右': '右', '前': '前', '後': '后',
  '上': '上', '下': '下', '中': '中', '外': '外', '內': '内',
};

const SIMPLIFIED_TO_TRADITIONAL: Record<string, string> = Object.fromEntries(
  Object.entries(TRADITIONAL_TO_SIMPLIFIED).map(([k, v]) => [v, k])
);

export const convert = new Hono();

// Convert text between simplified and traditional
convert.post('/', async (c) => {
  const { text, from, to } = await c.req.json();

  if (!text || !from || !to) {
    return c.json({ success: false, error: 'text, from, and to required' }, 400);
  }

  if (from === to) {
    return c.json({
      success: true,
      data: { original: text, converted: text },
    });
  }

  const mapping = from === 'traditional' ? TRADITIONAL_TO_SIMPLIFIED : SIMPLIFIED_TO_TRADITIONAL;

  let converted = '';
  for (const char of text) {
    converted += mapping[char] || char;
  }

  return c.json({
    success: true,
    data: { original: text, converted },
  });
});

// Get pinyin for text (simplified implementation)
convert.get('/pinyin', async (c) => {
  const text = c.req.query('text');

  if (!text) {
    return c.json({ success: false, error: 'text required' }, 400);
  }

  // This is a placeholder - real pinyin requires a dictionary or API
  // For demo, return empty pinyin
  const pinyin = text.split('').map(() => '?').join(' ');

  return c.json({
    success: true,
    data: { text, pinyin },
  });
});
