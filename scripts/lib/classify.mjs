/* 文献分类器（v3 体系）：颜色大类 + 细分 + 文献类型。
 *
 * 用于一次性迁移历史数据，以及后续更新脚本给新文献自动归类。
 * 输出只依赖题名 / 关键词 / 期刊，不读取摘要正文，避免背景描述干扰。
 *
 * 颜色大类：white / colored / transparent
 * 文献类型：research / review
 */

export const TYPE_NAMES = {
  research: '研究型论文',
  review: '综述',
};

export const CATEGORY_NAMES = {
  white: '白色辐射制冷',
  colored: '彩色辐射制冷',
  transparent: '透明辐射制冷',
};

const n = (s) => String(s || '').toLowerCase();

const RE = {
  // 标题出现透明/智能窗，才进入透明大类（关键词里出现 transparent 不算）
  transparent: /transparent|transparency|see-through|translucent|智能窗|透明|smart window|smart windows|glazing|window film|window coating/,
  window: /smart window|smart windows|glazing|window film|window coating|智能窗|天窗|玻璃幕墙/,

  color: /colou?r(?!less)|彩色|颜色|结构色|颜料|染料|荧光|磷光|发光|pigment|dye|fluorescen|phosphorescen|structural colou?r/,
  structural: /structural colou?r|结构色|photonic crystal|photonic crystals|bragg|colloidal crystal|colloidal photonic|amorphous photonic|光子晶体|非晶光子|干涉色/,
  luminescent: /fluorescen|phosphorescen|photoluminescen|luminescen|upconversion|afterglow|荧光|磷光|发光/,
  absorption: /pigment|dyes?\b|颜料|染料|colorant|着色剂/,
  chromic: /thermochromic|photochromic|electrochromic|chromogenic|switchable|adaptive|vo2|vanadium dioxide|phase[- ]change|\bpcm\b|热致变色|光致变色|电致变色|自适应|相变/,

  // 注意「纤维素」不是织物，用 (?!素) 排除
  textile: /textile|fabric|yarn|wearable|knitted|garment|apparel|metafabric|织物|可穿戴|面料|服装|纱线|纤维(?!素)/,
  wearable: /wearable|personal thermal management|body cooling|人体热管理|可穿戴|服装|织物|面料/,

  cement: /cement|concrete|ceramic|tiles?|brick|mortar|水泥|混凝土|陶瓷|瓷砖|砖/,
  inorganic: /inorganic|sio2|tio2|baso4|caco3|al2o3|zno|silicon carbide|silica|calcium carbonate|barium sulfate|titanium dioxide|silicon dioxide|aluminum oxide|zinc oxide|zirconium dioxide|boron nitride|perovskite|hydroxyapatite|strontium phosphate|phosphate|silicate|talc|mica|clay|graphene|carbon black|alumina|titania|zirconia|二氧化硅|二氧化钛|硫酸钡|碳酸钙|氧化铝|氧化锌|无机/,
  polymer: /pdms|pvdf|pmma|polyethylene|polypropylene|polyurethane|polystyrene|polyester|polyamide|poly\(|polyacrylic|polyvinyl|acrylic|epoxy|resin|cellulose|polymer|silicone|alginate|chitosan|gelatin|silk|wool|cotton|starch|lignin|rubber|hydrogel|nylon|ptfe|wood|pulp|bamboo|paper|hemp|flax|聚合物|树脂|纤维素|聚二甲基硅氧烷|聚偏氟乙烯|\bpet\b|\bpva\b|\bpeg\b|\bpe\b|\bpu\b|\bps\b|\bpi\b|\bpc\b/,
  hybrid: /composite|hybrid|filler|embed|disperse|填料|复合/,
  device: /device|module|prototype|generator|thermoelectric|water harvesting|heat exchanger|radiator|器件|装置|发电|水收集|热交换|heat sink/,

  review: /\breview\b|综述|\bprogress\b|prospects?|\badvances?\b|\boverview\b|\bperspective\b|进展|展望|a decade of/,
};

const PRIOR_SUB = {
  photonic: 'inorganic',
  porous: 'organic',
  coating: 'hybrid',
  application: 'special',
};

function titleOf(p) {
  return n(`${p.title_zh || ''} ${p.title_en || ''}`);
}

function keywordText(p) {
  return n((p.keywords || []).join(' '));
}

function abstractText(p) {
  const zh = /^（网络收录文献/.test(String(p.abstract_zh || '')) ? '' : String(p.abstract_zh || '');
  return n(`${zh} ${p.abstract_en || ''}`).slice(0, 1200);
}

function detectType(p, title) {
  if (p.review === true || p.type === '综述' || RE.review.test(title)) return 'review';
  return 'research';
}

/**
 * @returns {{category:string, sub:string, type:string, confidence:'high'|'medium'|'low', reasons:string[]}}
 */
export function classifyRecord(p) {
  const title = titleOf(p);
  const kw = keywordText(p);
  const both = `${title} ${kw}`;
  const ab = abstractText(p);
  const reasons = [];

  const type = detectType(p, title);
  if (type === 'review') reasons.push('综述标识');

  // ── 颜色大类 ─────────────────────────────────────────────
  let category;
  if (RE.transparent.test(title)) {
    category = 'transparent';
    reasons.push('标题含透明/智能窗');
  } else {
    const titleColor = RE.color.test(title);
    const kwColor = RE.color.test(kw);
    // 旧数据已标彩色的，只要有任一颜色信号就保留；否则按标题信号重判
    if (titleColor || (kwColor && p.category === 'colored')) category = 'colored';
    else category = 'white';
    if (category === 'colored') reasons.push(titleColor ? '标题含颜色信号' : '关键词含颜色信号');
  }

  // ── 细分方向 ─────────────────────────────────────────────
  let sub;
  let confidence = 'low';
  const strong = (re, label) => {
    if (re.test(title)) {
      confidence = 'high';
      reasons.push(label);
      return 'title';
    }
    if (re.test(kw)) {
      if (confidence !== 'high') confidence = 'medium';
      reasons.push(label);
      return 'keyword';
    }
    return '';
  };

  if (category === 'transparent') {
    sub = RE.window.test(title) ? 'smart-window' : 'film';
    confidence = 'high';
    reasons.push(sub === 'smart-window' ? '窗/幕墙器件' : '透明薄膜');
  } else if (category === 'colored') {
    if (strong(RE.textile, '织物/可穿戴')) sub = 'textile';
    else if (strong(RE.chromic, '变色/相变')) sub = 'colored-adaptive';
    else if (strong(RE.luminescent, '荧光/磷光')) sub = 'luminescent';
    else if (strong(RE.structural, '结构色')) sub = 'structural';
    else if (strong(RE.absorption, '颜料/染料')) sub = 'absorption';
    else {
      // 摘要里再找一次机制信号（题名/关键词没写清时）
      const fromAbstract = [
        ['structural', RE.structural],
        ['absorption', RE.absorption],
        ['luminescent', RE.luminescent],
        ['colored-adaptive', RE.chromic],
      ].find(([, re]) => re.test(ab));
      if (fromAbstract) {
        sub = fromAbstract[0];
        confidence = 'medium';
        reasons.push('摘要含机制信号');
      } else {
        sub = p.sub === 'structural' ? 'structural'
          : p.sub === 'pigment' ? 'absorption'
            : p.sub === 'textile' ? 'textile'
              : 'colored-adaptive';
        confidence = 'medium';
        reasons.push('按旧分类同义映射');
      }
    }
  } else {
    if (strong(RE.textile, '织物/可穿戴')) sub = 'wearable';
    else if (strong(RE.chromic, '自适应/相变')) sub = 'adaptive';
    else if (strong(RE.device, '器件/系统')) sub = 'special';
    else {
      const comp = `${both} ${ab}`;
      const hasCement = RE.cement.test(comp);
      const hasInorganic = RE.inorganic.test(comp) || hasCement;
      const hasPolymer = RE.polymer.test(comp);
      const hasHybrid = RE.hybrid.test(comp);
      const inTitle = (re) => re.test(title);
      const inKeyword = (re) => re.test(kw);
      if (hasCement && !hasPolymer) {
        sub = 'inorganic';
        confidence = inTitle(RE.cement) ? 'high' : inKeyword(RE.cement) ? 'medium' : 'low';
        reasons.push('水泥/陶瓷/砖');
      } else if (hasInorganic && hasPolymer) {
        sub = 'hybrid';
        confidence = inTitle(RE.inorganic) || inTitle(RE.polymer) ? 'high' : inKeyword(RE.inorganic) || inKeyword(RE.polymer) ? 'medium' : 'low';
        reasons.push('无机填料 + 高分子');
      } else if (hasInorganic) {
        // 旧分类为涂料的，若未明确全无机，按“涂料含胶粘剂”归入杂糅
        if (p.sub === 'coating' && !/inorganic|全无机|cement|ceramic|水泥|陶瓷/.test(both)) {
          sub = 'hybrid';
          confidence = 'medium';
          reasons.push('无机涂料（含胶粘剂）');
        } else {
          sub = 'inorganic';
          confidence = inTitle(RE.inorganic) ? 'high' : inKeyword(RE.inorganic) ? 'medium' : 'low';
          reasons.push('无机体系');
        }
      } else if (hasPolymer) {
        sub = hasHybrid ? 'hybrid' : 'organic';
        confidence = inTitle(RE.polymer) || inTitle(RE.hybrid) ? 'high' : inKeyword(RE.polymer) || inKeyword(RE.hybrid) ? 'medium' : 'low';
        reasons.push(hasHybrid ? '聚合物复合' : '聚合物本体');
      } else {
        sub = PRIOR_SUB[p.sub] || 'special';
        confidence = p.sub === 'application' ? 'low' : 'medium';
        reasons.push('无组成信号，按旧分类同义映射');
      }
    }
  }

  return { category, sub, type, confidence, reasons };
}

/** 类型中文名（未知值回退为研究型论文） */
export function typeName(key) {
  return TYPE_NAMES[key] || TYPE_NAMES.research;
}
