import type { EtfReport } from './etf-contract';

export const seedReport: EtfReport = {
  schemaVersion: 1,
  id: 'active-etf-flows-2026-10-13',
  reportType: 'flows',
  title: '液冷與光通訊獲部分基金增持，材料與載板仍有分歧',
  excerpt: '39筆持股異動中有33筆增持、6筆減持；高力、奇鋐與大立光各獲2／5檔基金增持。00406A的23筆全增持仍須核對受益單位，不能直接解讀為一致看多。',
  period: {
    start: '2026-10-12',
    end: '2026-10-13'
  },
  evidenceDate: '2026-10-14',
  funds: [
    {
      code: '00981A',
      name: '主動統一台股增長',
      aumBillion: 291.24,
      rankAsOf: '2026-10-13T10:00:00+08:00',
      holdingsDate: '2026-10-13',
      coverage: '已取得來源異動5筆；網站標示10/12→10/13；官方完整兩端與受益單位對帳尚未完成。',
      sourceUrl: 'https://www.etfinfo.tw/etf/00981A/active'
    },
    {
      code: '00403A',
      name: '主動統一升級50',
      aumBillion: 143.54,
      rankAsOf: '2026-10-13T10:00:00+08:00',
      holdingsDate: '2026-10-13',
      coverage: '已取得來源異動6筆；網站標示10/12→10/13；官方完整兩端與受益單位對帳尚未完成。',
      sourceUrl: 'https://www.etfinfo.tw/etf/00403A/active'
    },
    {
      code: '00991A',
      name: '主動復華未來50',
      aumBillion: 78,
      rankAsOf: '2026-10-13T10:00:00+08:00',
      holdingsDate: '2026-10-13',
      coverage: '已取得來源異動4筆；網站標示10/12→10/13；官方完整兩端與受益單位對帳尚未完成。第三、第四名的官方同時點規模排序尚未確認。',
      sourceUrl: 'https://www.etfinfo.tw/etf/00991A/active'
    },
    {
      code: '00406A',
      name: '主動中信台灣收益',
      aumBillion: 65.73,
      rankAsOf: '2026-10-13T10:00:00+08:00',
      holdingsDate: '2026-10-13',
      coverage: '已取得來源異動23筆；網站標示10/12→10/13；官方完整兩端與受益單位對帳尚未完成。第三、第四名的官方同時點規模排序尚未確認；23筆全增持不代表已確認主動看多。',
      sourceUrl: 'https://www.etfinfo.tw/etf/00406A/active'
    },
    {
      code: '00982A',
      name: '主動群益台灣強棒',
      aumBillion: 51.64,
      rankAsOf: '2026-10-13T10:00:00+08:00',
      holdingsDate: '2026-10-13',
      coverage: '已取得來源異動1筆；網站標示10/12→10/13；官方完整兩端與受益單位對帳尚未完成。另有官方評價日與網站標示日落差待釐清。',
      sourceUrl: 'https://www.etfinfo.tw/etf/00982A/active'
    }
  ],
  rows: [
    {
      etf: '00981A',
      code: '2330',
      name: '台積電',
      sector: '半導體',
      deltaLots: 364,
      weightDeltaPp: null,
      estimateNtd: 910000000,
      sourceUrl: 'https://www.etfinfo.tw/etf/00981A/active',
      sourceDate: '2026-10-13'
    },
    {
      etf: '00981A',
      code: '8996',
      name: '高力',
      sector: '熱管理',
      deltaLots: 100,
      weightDeltaPp: null,
      estimateNtd: 170000000,
      sourceUrl: 'https://www.etfinfo.tw/etf/00981A/active',
      sourceDate: '2026-10-13'
    },
    {
      etf: '00981A',
      code: '3017',
      name: '奇鋐',
      sector: '熱管理',
      deltaLots: 85,
      weightDeltaPp: null,
      estimateNtd: 280000000,
      sourceUrl: 'https://www.etfinfo.tw/etf/00981A/active',
      sourceDate: '2026-10-13'
    },
    {
      etf: '00981A',
      code: '6274',
      name: '台燿',
      sector: 'CCL／電子材料',
      deltaLots: 76,
      weightDeltaPp: null,
      estimateNtd: 130000000,
      sourceUrl: 'https://www.etfinfo.tw/etf/00981A/active',
      sourceDate: '2026-10-13'
    },
    {
      etf: '00981A',
      code: '2383',
      name: '台光電',
      sector: 'CCL／電子材料',
      deltaLots: -322,
      weightDeltaPp: null,
      estimateNtd: -1780000000,
      sourceUrl: 'https://www.etfinfo.tw/etf/00981A/active',
      sourceDate: '2026-10-13'
    },
    {
      etf: '00403A',
      code: '2313',
      name: '華通',
      sector: 'PCB／載板',
      deltaLots: 400,
      weightDeltaPp: null,
      estimateNtd: 100000000,
      sourceUrl: 'https://www.etfinfo.tw/etf/00403A/active',
      sourceDate: '2026-10-13'
    },
    {
      etf: '00403A',
      code: '3008',
      name: '大立光',
      sector: '光學／光通訊',
      deltaLots: 92,
      weightDeltaPp: null,
      estimateNtd: 630000000,
      sourceUrl: 'https://www.etfinfo.tw/etf/00403A/active',
      sourceDate: '2026-10-13'
    },
    {
      etf: '00403A',
      code: '8996',
      name: '高力',
      sector: '熱管理',
      deltaLots: 80,
      weightDeltaPp: null,
      estimateNtd: 130000000,
      sourceUrl: 'https://www.etfinfo.tw/etf/00403A/active',
      sourceDate: '2026-10-13'
    },
    {
      etf: '00403A',
      code: '3037',
      name: '欣興',
      sector: 'PCB／載板',
      deltaLots: -800,
      weightDeltaPp: null,
      estimateNtd: -950000000,
      sourceUrl: 'https://www.etfinfo.tw/etf/00403A/active',
      sourceDate: '2026-10-13'
    },
    {
      etf: '00403A',
      code: '2481',
      name: '強茂',
      sector: '半導體',
      deltaLots: -600,
      weightDeltaPp: null,
      estimateNtd: -100000000,
      sourceUrl: 'https://www.etfinfo.tw/etf/00403A/active',
      sourceDate: '2026-10-13'
    },
    {
      etf: '00403A',
      code: '6488',
      name: '環球晶',
      sector: '半導體',
      deltaLots: -400,
      weightDeltaPp: null,
      estimateNtd: -410000000,
      sourceUrl: 'https://www.etfinfo.tw/etf/00403A/active',
      sourceDate: '2026-10-13'
    },
    {
      etf: '00991A',
      code: '1303',
      name: '南亞',
      sector: 'CCL／電子材料',
      deltaLots: 200,
      weightDeltaPp: null,
      estimateNtd: 70000000,
      sourceUrl: 'https://www.etfinfo.tw/etf/00991A/active',
      sourceDate: '2026-10-13'
    },
    {
      etf: '00991A',
      code: '3037',
      name: '欣興',
      sector: 'PCB／載板',
      deltaLots: 70,
      weightDeltaPp: null,
      estimateNtd: 83000000,
      sourceUrl: 'https://www.etfinfo.tw/etf/00991A/active',
      sourceDate: '2026-10-13'
    },
    {
      etf: '00991A',
      code: '3008',
      name: '大立光',
      sector: '光學／光通訊',
      deltaLots: 24,
      weightDeltaPp: null,
      estimateNtd: 170000000,
      sourceUrl: 'https://www.etfinfo.tw/etf/00991A/active',
      sourceDate: '2026-10-13'
    },
    {
      etf: '00991A',
      code: '2308',
      name: '台達電',
      sector: '電源／電力設備',
      deltaLots: -199,
      weightDeltaPp: null,
      estimateNtd: -360000000,
      sourceUrl: 'https://www.etfinfo.tw/etf/00991A/active',
      sourceDate: '2026-10-13'
    },
    {
      etf: '00406A',
      code: '2330',
      name: '台積電',
      sector: '半導體',
      deltaLots: 430,
      weightDeltaPp: null,
      estimateNtd: 1070000000,
      sourceUrl: 'https://www.etfinfo.tw/etf/00406A/active',
      sourceDate: '2026-10-13'
    },
    {
      etf: '00406A',
      code: '2383',
      name: '台光電',
      sector: 'CCL／電子材料',
      deltaLots: 140,
      weightDeltaPp: null,
      estimateNtd: 770000000,
      sourceUrl: 'https://www.etfinfo.tw/etf/00406A/active',
      sourceDate: '2026-10-13'
    },
    {
      etf: '00406A',
      code: '2345',
      name: '智邦',
      sector: '網通',
      deltaLots: 245,
      weightDeltaPp: null,
      estimateNtd: 500000000,
      sourceUrl: 'https://www.etfinfo.tw/etf/00406A/active',
      sourceDate: '2026-10-13'
    },
    {
      etf: '00406A',
      code: '3037',
      name: '欣興',
      sector: 'PCB／載板',
      deltaLots: 400,
      weightDeltaPp: null,
      estimateNtd: 470000000,
      sourceUrl: 'https://www.etfinfo.tw/etf/00406A/active',
      sourceDate: '2026-10-13'
    },
    {
      etf: '00406A',
      code: '8046',
      name: '南電',
      sector: 'PCB／載板',
      deltaLots: 300,
      weightDeltaPp: null,
      estimateNtd: 430000000,
      sourceUrl: 'https://www.etfinfo.tw/etf/00406A/active',
      sourceDate: '2026-10-13'
    },
    {
      etf: '00406A',
      code: '4958',
      name: '臻鼎-KY',
      sector: 'PCB／載板',
      deltaLots: 653,
      weightDeltaPp: null,
      estimateNtd: 370000000,
      sourceUrl: 'https://www.etfinfo.tw/etf/00406A/active',
      sourceDate: '2026-10-13'
    },
    {
      etf: '00406A',
      code: '2454',
      name: '聯發科',
      sector: '半導體',
      deltaLots: 80,
      weightDeltaPp: null,
      estimateNtd: 360000000,
      sourceUrl: 'https://www.etfinfo.tw/etf/00406A/active',
      sourceDate: '2026-10-13'
    },
    {
      etf: '00406A',
      code: '3017',
      name: '奇鋐',
      sector: '熱管理',
      deltaLots: 85,
      weightDeltaPp: null,
      estimateNtd: 280000000,
      sourceUrl: 'https://www.etfinfo.tw/etf/00406A/active',
      sourceDate: '2026-10-13'
    },
    {
      etf: '00406A',
      code: '2481',
      name: '強茂',
      sector: '半導體',
      deltaLots: 750,
      weightDeltaPp: null,
      estimateNtd: 120000000,
      sourceUrl: 'https://www.etfinfo.tw/etf/00406A/active',
      sourceDate: '2026-10-13'
    },
    {
      etf: '00406A',
      code: '1303',
      name: '南亞',
      sector: 'CCL／電子材料',
      deltaLots: 680,
      weightDeltaPp: null,
      estimateNtd: 240000000,
      sourceUrl: 'https://www.etfinfo.tw/etf/00406A/active',
      sourceDate: '2026-10-13'
    },
    {
      etf: '00406A',
      code: '2327',
      name: '國巨*',
      sector: '電子零組件',
      deltaLots: 370,
      weightDeltaPp: null,
      estimateNtd: 230000000,
      sourceUrl: 'https://www.etfinfo.tw/etf/00406A/active',
      sourceDate: '2026-10-13'
    },
    {
      etf: '00406A',
      code: '6147',
      name: '頎邦',
      sector: '半導體',
      deltaLots: 345,
      weightDeltaPp: null,
      estimateNtd: 76250000,
      sourceUrl: 'https://www.etfinfo.tw/etf/00406A/active',
      sourceDate: '2026-10-13'
    },
    {
      etf: '00406A',
      code: '3189',
      name: '景碩',
      sector: 'PCB／載板',
      deltaLots: 200,
      weightDeltaPp: null,
      estimateNtd: 210000000,
      sourceUrl: 'https://www.etfinfo.tw/etf/00406A/active',
      sourceDate: '2026-10-13'
    },
    {
      etf: '00406A',
      code: '3167',
      name: '大量',
      sector: '製造／測試設備',
      deltaLots: 200,
      weightDeltaPp: null,
      estimateNtd: 190000000,
      sourceUrl: 'https://www.etfinfo.tw/etf/00406A/active',
      sourceDate: '2026-10-13'
    },
    {
      etf: '00406A',
      code: '2368',
      name: '金像電',
      sector: 'PCB／載板',
      deltaLots: 186,
      weightDeltaPp: null,
      estimateNtd: 230000000,
      sourceUrl: 'https://www.etfinfo.tw/etf/00406A/active',
      sourceDate: '2026-10-13'
    },
    {
      etf: '00406A',
      code: '3711',
      name: '日月光投控',
      sector: '半導體',
      deltaLots: 150,
      weightDeltaPp: null,
      estimateNtd: 110000000,
      sourceUrl: 'https://www.etfinfo.tw/etf/00406A/active',
      sourceDate: '2026-10-13'
    },
    {
      etf: '00406A',
      code: '6715',
      name: '嘉基',
      sector: '電子零組件',
      deltaLots: 55,
      weightDeltaPp: null,
      estimateNtd: 30640000,
      sourceUrl: 'https://www.etfinfo.tw/etf/00406A/active',
      sourceDate: '2026-10-13'
    },
    {
      etf: '00406A',
      code: '2360',
      name: '致茂',
      sector: '製造／測試設備',
      deltaLots: 50,
      weightDeltaPp: null,
      estimateNtd: 110000000,
      sourceUrl: 'https://www.etfinfo.tw/etf/00406A/active',
      sourceDate: '2026-10-13'
    },
    {
      etf: '00406A',
      code: '3661',
      name: '世芯-KY',
      sector: '半導體',
      deltaLots: 34,
      weightDeltaPp: null,
      estimateNtd: 130000000,
      sourceUrl: 'https://www.etfinfo.tw/etf/00406A/active',
      sourceDate: '2026-10-13'
    },
    {
      etf: '00406A',
      code: '3653',
      name: '健策',
      sector: '熱管理',
      deltaLots: 30,
      weightDeltaPp: null,
      estimateNtd: 210000000,
      sourceUrl: 'https://www.etfinfo.tw/etf/00406A/active',
      sourceDate: '2026-10-13'
    },
    {
      etf: '00406A',
      code: '6510',
      name: '精測',
      sector: '半導體',
      deltaLots: 30,
      weightDeltaPp: null,
      estimateNtd: 98250000,
      sourceUrl: 'https://www.etfinfo.tw/etf/00406A/active',
      sourceDate: '2026-10-13'
    },
    {
      etf: '00406A',
      code: '3443',
      name: '創意',
      sector: '半導體',
      deltaLots: 15,
      weightDeltaPp: null,
      estimateNtd: 120000000,
      sourceUrl: 'https://www.etfinfo.tw/etf/00406A/active',
      sourceDate: '2026-10-13'
    },
    {
      etf: '00406A',
      code: '5274',
      name: '信驊',
      sector: '半導體',
      deltaLots: 4,
      weightDeltaPp: null,
      estimateNtd: 69400000,
      sourceUrl: 'https://www.etfinfo.tw/etf/00406A/active',
      sourceDate: '2026-10-13'
    },
    {
      etf: '00982A',
      code: '2377',
      name: '微星',
      sector: '電腦週邊',
      deltaLots: -1672,
      weightDeltaPp: null,
      estimateNtd: -270000000,
      sourceUrl: 'https://www.etfinfo.tw/etf/00982A/active',
      sourceDate: '2026-10-13'
    }
  ],
  summary: [
    {
      title: '部分基金增持液冷與光通訊，材料與載板仍有分歧',
      text: '這期較有證據的解讀，是部分基金增加熱管理與光通訊的成長曝險，同時調整材料、載板內的個股權重。高力、奇鋐、大立光各有2/5檔基金增持，並非五檔一致；台光電與欣興則有相反操作。下方數據用來區分「產業動態支持增持」與「基本面強、基金仍減持」兩種情況。',
      sources: [
        {
          label: '00981A 主動統一台股增長異動',
          url: 'https://www.etfinfo.tw/etf/00981A/active',
          eventDate: null
        },
        {
          label: '00403A 主動統一升級50異動',
          url: 'https://www.etfinfo.tw/etf/00403A/active',
          eventDate: null
        },
        {
          label: '00991A 主動復華未來50異動',
          url: 'https://www.etfinfo.tw/etf/00991A/active',
          eventDate: null
        },
        {
          label: '00406A 主動中信台灣收益異動',
          url: 'https://www.etfinfo.tw/etf/00406A/active',
          eventDate: null
        }
      ]
    },
    {
      title: '液冷需求支持出貨，獲利仍要看產品組合與成本',
      text: '液冷的支持來自客戶需求與出貨，而不只是AI標籤。奇鋐9月營收年增44.92%，公告及法說報導提到GPU、ASIC液冷客戶需求；高力年增153.7%，同時受液冷與燃料電池拉貨支持。這些消息可能讓基金提高對出貨成長的曝險，但獲利能否跟上仍取決於產品組合、產能利用與擴產成本。',
      sources: [
        {
          label: '奇鋐10/7公告報導',
          url: 'https://tw.finance.yahoo.com/quote/3017.TW/news',
          eventDate: '2026-10-07'
        },
        {
          label: '高力10/6營運動態',
          url: 'https://www.moneydj.com/KMDJ/news/newsviewer.aspx?a=22f1e1be-df7e-4607-be8e-48d5f23f5e3c',
          eventDate: '2026-10-06'
        }
      ]
    },
    {
      title: '大立光的新業務需要量產與毛利率驗證',
      text: '大立光較像在評估新業務選項，而非押注當季獲利改善。兩檔合計增116張，升級50的部位增加37.9%；10/8法說的FA認證與FAU量產規劃，增加手機鏡頭以外的收入可能。但Q3毛利率42.2%、季減7.22個百分點，良率與綠電成本仍承壓。新題材的投資邏輯要靠認證轉量產、實際出貨與毛利率確認，尚不能當成已兌現獲利。',
      sources: [
        {
          label: '大立光10/8法說',
          url: 'https://www.cna.com.tw/news/afe/202610080326.aspx',
          eventDate: '2026-10-08'
        }
      ]
    },
    {
      title: '材料與載板營運強勁，基金操作仍有取捨',
      text: '材料／載板的減持，不能直接歸因於需求轉弱。台光電、欣興9月營收分別年增168.87%、64.7%，卻淨減182、330張；同時台燿增76張、華通增400張。高階載板出貨、新產能與華通低軌衛星／資料中心動能，支持部分增持；反向減持較可能涉及權重、相對評價或公司差異，但目前沒有估值或基金說明可證實。南亞增880張亦與材料需求、售價和Q3 EPS4.90元的消息相符，惟南亞科投資收益235.6億元也有重要貢獻，不能把獲利全歸因材料漲價。',
      sources: [
        {
          label: '台光電營收',
          url: 'https://news.cnyes.com/news/id/6621836',
          eventDate: null
        },
        {
          label: '欣興高階載板動態',
          url: 'https://tw.stock.yahoo.com/news/載板供不應求-欣興-臻鼎9月營收飆新高-213000155.html',
          eventDate: null
        },
        {
          label: '華通AI／低軌衛星',
          url: 'https://www.moneydj.com/kmdj/news/newsviewer.aspx?a=13aa600c-30ce-40ca-b650-df6754c01a41',
          eventDate: null
        },
        {
          label: '南亞財報',
          url: 'https://money.udn.com/money/amp/story/5607/9811261',
          eventDate: null
        }
      ]
    },
    {
      title: '先排除份額擴張，再解讀單一基金操作',
      text: '有兩項操作仍不能用題材解釋。中信收益23筆全增持、逐筆網站估算合計增加64.2454億元，須先核對受益單位，排除申購帶動的組合擴張；微星減1,672張僅一檔基金，9月營收年增1.83%、前三季年減5.48%，只提供相對成長較弱的背景，沒有直接消息可確認減持原因。這些是依數據提出的候選解釋，非經理人已公開的交易動機。',
      sources: [
        {
          label: '中信收益異動',
          url: 'https://www.etfinfo.tw/etf/00406A/active',
          eventDate: null
        },
        {
          label: '微星營收',
          url: 'https://www.wantgoo.com/stock/2377/financial-statements/monthly-revenue',
          eventDate: null
        }
      ]
    }
  ],
  operations: [
    {
      code: '3017',
      name: '奇鋐',
      metrics: [
        {
          label: '營收年增率',
          value: '44.92%',
          period: '2026年9月'
        }
      ],
      eventDate: '2026-10-07',
      sourceUrl: 'https://tw.finance.yahoo.com/quote/3017.TW/news'
    },
    {
      code: '8996',
      name: '高力',
      metrics: [
        {
          label: '營收年增率',
          value: '153.70%',
          period: '2026年9月'
        }
      ],
      eventDate: '2026-10-06',
      sourceUrl: 'https://www.moneydj.com/KMDJ/news/newsviewer.aspx?a=22f1e1be-df7e-4607-be8e-48d5f23f5e3c'
    },
    {
      code: '3008',
      name: '大立光',
      metrics: [
        {
          label: 'FA認證',
          value: '法說披露',
          period: '2026/10/08法說'
        },
        {
          label: 'FAU量產',
          value: '規劃階段',
          period: '2026/10/08法說'
        },
        {
          label: '毛利率',
          value: '42.2%',
          period: '2026年第3季'
        },
        {
          label: '毛利率季差',
          value: '−7.22個百分點',
          period: '2026年第3季比第2季'
        }
      ],
      eventDate: '2026-10-08',
      sourceUrl: 'https://www.cna.com.tw/news/afe/202610080326.aspx'
    },
    {
      code: '2383',
      name: '台光電',
      metrics: [
        {
          label: '營收年增率',
          value: '168.87%',
          period: '2026年9月'
        }
      ],
      eventDate: null,
      sourceUrl: 'https://news.cnyes.com/news/id/6621836'
    },
    {
      code: '3037',
      name: '欣興',
      metrics: [
        {
          label: '營收年增率',
          value: '64.70%',
          period: '2026年9月'
        }
      ],
      eventDate: null,
      sourceUrl: 'https://tw.stock.yahoo.com/news/載板供不應求-欣興-臻鼎9月營收飆新高-213000155.html'
    },
    {
      code: '1303',
      name: '南亞',
      metrics: [
        {
          label: 'EPS',
          value: '4.90元（含本業與轉投資收益）',
          period: '2026年第3季'
        },
        {
          label: '南亞科投資收益',
          value: '235.6億元',
          period: '2026年第3季'
        }
      ],
      eventDate: null,
      sourceUrl: 'https://money.udn.com/money/amp/story/5607/9811261'
    },
    {
      code: '2377',
      name: '微星',
      metrics: [
        {
          label: '營收年增率',
          value: '1.83%',
          period: '2026年9月'
        },
        {
          label: '累計營收年增率',
          value: '−5.48%',
          period: '2026年前3季'
        }
      ],
      eventDate: null,
      sourceUrl: 'https://www.wantgoo.com/stock/2377/financial-statements/monthly-revenue'
    }
  ],
  sampleNote: 'STAGING驗收用研究快照；持股10/12→10/13，產業證據補查10/14。沿用10/13上午研究組，非即時資料，也不是已確認的同期AUM完整排行；AUM只作歷史選樣。每筆異動依研究業務分組只計一次，南亞列電子材料不代表其全部營收曝險。',
  warnings: [
    '股數差、權重差與網站估算分開。網站估算不是實際成交、申購金額或市場新錢流入；價格基準與估算方法未完整披露。',
    '五檔官方完整兩端及受益單位對帳未完成；00406A23筆全增持可能包含申購帶動的組合擴張。',
    '原正文00406A估算64.6億元與23筆明細不一致。本快照依原始明細重算為64.2454億元；五檔明細合計52.2754億元，不混用舊圖52.6億元。',
    '歷史選樣AUM時點不一致，第三、第四名同日官方排序尚未確認；不將最新排行當成歷史排行。',
    '未觀測表示已取得異動清單未列出，不代表無持股或官方零操作；未知表示未取得或日期不可比。',
    '熱力圖色深僅代表同方向異動個股檔數，雙向格保留增減兩數；不可依跨股票張數排名資金強度。',
    '營運消息與操作同向不證明交易因果；候選原因不是經理人已公開的交易動機。營收成長不等於獲利改善。',
    '奇鋐消息連結為新聞索引，直接公告連結未取得；四家公司的公告日期未記錄，未以10/14補查日代替事件日。',
    '完整持股268列是網站完整性，不代表五檔完成官方同日認證；低於0.01%的正部位保留上界，不當成零或退出。',
    '來源網站可更新；此資料保留抽取快照所記10/12→10/13期間。多站共用投信資料，交叉一致不等於獨立官方核對。',
    '來源HTML SHA256：3857741a62c19234d376175c903ea10ea5de8a6c8cd92bf7f651112d8018f7f9'
  ],
  holdings: [
    {
      etf: '00981A',
      date: '2026-10-13',
      sourceUrl: 'https://act-etf.fundmeow.com/#tab=etf',
      note: '10/13官方完整表已核對；官方表50筆，與第三方證券代碼及一般權重一致。19筆官方權重四捨五入為0.00%，但股數為正；第三方標示低於0.01%。保留兩者，不當成退出。 分類依2026/10/12 TWSE／TPEx公司產業，非研究業務板塊。已列全部網站股票列；低於0.01%未補零，餘額不視為現金。',
      rows: [
        {
          code: '2330',
          name: '台積電',
          sector: '半導體業',
          market: '上市',
          weightPct: 10.79,
          weightUpperBoundPct: null,
          weightRaw: '10.79%',
          shares: 12188000
        },
        {
          code: '2383',
          name: '台光電',
          sector: '電子零組件業',
          market: '上市',
          weightPct: 8.53,
          weightUpperBoundPct: null,
          weightRaw: '8.53%',
          shares: 4328000
        },
        {
          code: '2454',
          name: '聯發科',
          sector: '半導體業',
          market: '上市',
          weightPct: 8.18,
          weightUpperBoundPct: null,
          weightRaw: '8.18%',
          shares: 5086000
        },
        {
          code: '3037',
          name: '欣興',
          sector: '電子零組件業',
          market: '上市',
          weightPct: 7.85,
          weightUpperBoundPct: null,
          weightRaw: '7.85%',
          shares: 18721000
        },
        {
          code: '3017',
          name: '奇鋐',
          sector: '電腦及週邊業',
          market: '上市',
          weightPct: 7.17,
          weightUpperBoundPct: null,
          weightRaw: '7.17%',
          shares: 6147000
        },
        {
          code: '3653',
          name: '健策',
          sector: '電子零組件業',
          market: '上市',
          weightPct: 6.22,
          weightUpperBoundPct: null,
          weightRaw: '6.22%',
          shares: 2502000
        },
        {
          code: '6223',
          name: '旺矽',
          sector: '半導體業',
          market: '上櫃',
          weightPct: 5.29,
          weightUpperBoundPct: null,
          weightRaw: '5.29%',
          shares: 2504000
        },
        {
          code: '2327',
          name: '國巨*',
          sector: '電子零組件業',
          market: '上市',
          weightPct: 5.01,
          weightUpperBoundPct: null,
          weightRaw: '5.01%',
          shares: 23519000
        },
        {
          code: '2308',
          name: '台達電',
          sector: '電子零組件業',
          market: '上市',
          weightPct: 4.66,
          weightUpperBoundPct: null,
          weightRaw: '4.66%',
          shares: 7389000
        },
        {
          code: '8046',
          name: '南電',
          sector: '電子零組件業',
          market: '上市',
          weightPct: 4.57,
          weightUpperBoundPct: null,
          weightRaw: '4.57%',
          shares: 8937000
        },
        {
          code: '2345',
          name: '智邦',
          sector: '通信網路業',
          market: '上市',
          weightPct: 4.54,
          weightUpperBoundPct: null,
          weightRaw: '4.54%',
          shares: 6264000
        },
        {
          code: '6274',
          name: '台燿',
          sector: '電子零組件業',
          market: '上櫃',
          weightPct: 4.03,
          weightUpperBoundPct: null,
          weightRaw: '4.03%',
          shares: 6847000
        },
        {
          code: '2303',
          name: '聯電',
          sector: '半導體業',
          market: '上市',
          weightPct: 4,
          weightUpperBoundPct: null,
          weightRaw: '4.00%',
          shares: 79618000
        },
        {
          code: '6669',
          name: '緯穎',
          sector: '電腦及週邊業',
          market: '上市',
          weightPct: 3.37,
          weightUpperBoundPct: null,
          weightRaw: '3.37%',
          shares: 4315561
        },
        {
          code: '3665',
          name: '貿聯-KY',
          sector: '其他電子業',
          market: '上市',
          weightPct: 2.32,
          weightUpperBoundPct: null,
          weightRaw: '2.32%',
          shares: 2887848
        },
        {
          code: '3711',
          name: '日月光投控',
          sector: '半導體業',
          market: '上市',
          weightPct: 2.2,
          weightUpperBoundPct: null,
          weightRaw: '2.20%',
          shares: 8348000
        },
        {
          code: '3443',
          name: '創意',
          sector: '半導體業',
          market: '上市',
          weightPct: 1.97,
          weightUpperBoundPct: null,
          weightRaw: '1.97%',
          shares: 684000
        },
        {
          code: '2368',
          name: '金像電',
          sector: '電子零組件業',
          market: '上市',
          weightPct: 1.56,
          weightUpperBoundPct: null,
          weightRaw: '1.56%',
          shares: 3741000
        },
        {
          code: '5274',
          name: '信驊',
          sector: '半導體業',
          market: '上櫃',
          weightPct: 0.97,
          weightUpperBoundPct: null,
          weightRaw: '0.97%',
          shares: 157900
        },
        {
          code: '6510',
          name: '精測',
          sector: '半導體業',
          market: '上櫃',
          weightPct: 0.49,
          weightUpperBoundPct: null,
          weightRaw: '0.49%',
          shares: 420000
        },
        {
          code: '2449',
          name: '京元電子',
          sector: '半導體業',
          market: '上市',
          weightPct: 0.45,
          weightUpperBoundPct: null,
          weightRaw: '0.45%',
          shares: 4143450
        },
        {
          code: '6805',
          name: '富世達',
          sector: '電子零組件業',
          market: '上市',
          weightPct: 0.39,
          weightUpperBoundPct: null,
          weightRaw: '0.39%',
          shares: 499000
        },
        {
          code: '8996',
          name: '高力',
          sector: '電機機械',
          market: '上市',
          weightPct: 0.35,
          weightUpperBoundPct: null,
          weightRaw: '0.35%',
          shares: 576000
        },
        {
          code: '6271',
          name: '同欣電',
          sector: '半導體業',
          market: '上市',
          weightPct: 0.19,
          weightUpperBoundPct: null,
          weightRaw: '0.19%',
          shares: 2185000
        },
        {
          code: '6515',
          name: '穎崴',
          sector: '半導體業',
          market: '上市',
          weightPct: 0.19,
          weightUpperBoundPct: null,
          weightRaw: '0.19%',
          shares: 93000
        },
        {
          code: '8210',
          name: '勤誠',
          sector: '電腦及週邊業',
          market: '上市',
          weightPct: 0.14,
          weightUpperBoundPct: null,
          weightRaw: '0.14%',
          shares: 478000
        },
        {
          code: '6191',
          name: '精成科',
          sector: '電子零組件業',
          market: '上市',
          weightPct: 0.13,
          weightUpperBoundPct: null,
          weightRaw: '0.13%',
          shares: 3921000
        },
        {
          code: '3376',
          name: '新日興',
          sector: '電子零組件業',
          market: '上市',
          weightPct: 0.1,
          weightUpperBoundPct: null,
          weightRaw: '0.10%',
          shares: 1740000
        },
        {
          code: '6187',
          name: '萬潤',
          sector: '半導體業',
          market: '上櫃',
          weightPct: 0.07,
          weightUpperBoundPct: null,
          weightRaw: '0.07%',
          shares: 121000
        },
        {
          code: '2002',
          name: '中鋼',
          sector: '鋼鐵工業',
          market: '上市',
          weightPct: 0.04,
          weightUpperBoundPct: null,
          weightRaw: '0.04%',
          shares: 5163000
        },
        {
          code: '2313',
          name: '華通',
          sector: '電子零組件業',
          market: '上市',
          weightPct: 0.04,
          weightUpperBoundPct: null,
          weightRaw: '0.04%',
          shares: 501000
        },
        {
          code: '4979',
          name: '華星光',
          sector: '通信網路業',
          market: '上櫃',
          weightPct: null,
          weightUpperBoundPct: 0.01,
          weightRaw: '<0.01%',
          shares: 1000
        },
        {
          code: '5347',
          name: '世界',
          sector: '半導體業',
          market: '上櫃',
          weightPct: null,
          weightUpperBoundPct: 0.01,
          weightRaw: '<0.01%',
          shares: 1000
        },
        {
          code: '2317',
          name: '鴻海',
          sector: '其他電子業',
          market: '上市',
          weightPct: null,
          weightUpperBoundPct: 0.01,
          weightRaw: '<0.01%',
          shares: 1000
        },
        {
          code: '8150',
          name: '南茂',
          sector: '半導體業',
          market: '上市',
          weightPct: null,
          weightUpperBoundPct: 0.01,
          weightRaw: '<0.01%',
          shares: 1000
        },
        {
          code: '4966',
          name: '譜瑞-KY',
          sector: '半導體業',
          market: '上櫃',
          weightPct: null,
          weightUpperBoundPct: 0.01,
          weightRaw: '<0.01%',
          shares: 1000
        },
        {
          code: '6488',
          name: '環球晶',
          sector: '半導體業',
          market: '上櫃',
          weightPct: null,
          weightUpperBoundPct: 0.01,
          weightRaw: '<0.01%',
          shares: 1000
        },
        {
          code: '2360',
          name: '致茂',
          sector: '其他電子業',
          market: '上市',
          weightPct: null,
          weightUpperBoundPct: 0.01,
          weightRaw: '<0.01%',
          shares: 1000
        },
        {
          code: '2637',
          name: '慧洋-KY',
          sector: '航運業',
          market: '上市',
          weightPct: null,
          weightUpperBoundPct: 0.01,
          weightRaw: '<0.01%',
          shares: 1000
        },
        {
          code: '2408',
          name: '南亞科',
          sector: '半導體業',
          market: '上市',
          weightPct: null,
          weightUpperBoundPct: 0.01,
          weightRaw: '<0.01%',
          shares: 1000
        },
        {
          code: '4958',
          name: '臻鼎-KY',
          sector: '電子零組件業',
          market: '上市',
          weightPct: null,
          weightUpperBoundPct: 0.01,
          weightRaw: '<0.01%',
          shares: 1000
        },
        {
          code: '2382',
          name: '廣達',
          sector: '電腦及週邊業',
          market: '上市',
          weightPct: null,
          weightUpperBoundPct: 0.01,
          weightRaw: '<0.01%',
          shares: 1000
        },
        {
          code: '3008',
          name: '大立光',
          sector: '光電業',
          market: '上市',
          weightPct: null,
          weightUpperBoundPct: 0.01,
          weightRaw: '<0.01%',
          shares: 1000
        },
        {
          code: '1590',
          name: '亞德客-KY',
          sector: '電機機械',
          market: '上市',
          weightPct: null,
          weightUpperBoundPct: 0.01,
          weightRaw: '<0.01%',
          shares: 1000
        },
        {
          code: '2439',
          name: '美律',
          sector: '通信網路業',
          market: '上市',
          weightPct: null,
          weightUpperBoundPct: 0.01,
          weightRaw: '<0.01%',
          shares: 1000
        },
        {
          code: '3661',
          name: '世芯-KY',
          sector: '半導體業',
          market: '上市',
          weightPct: null,
          weightUpperBoundPct: 0.01,
          weightRaw: '<0.01%',
          shares: 1000
        },
        {
          code: '8358',
          name: '金居',
          sector: '電子零組件業',
          market: '上櫃',
          weightPct: null,
          weightUpperBoundPct: 0.01,
          weightRaw: '<0.01%',
          shares: 1000
        },
        {
          code: '6278',
          name: '台表科',
          sector: '光電業',
          market: '上市',
          weightPct: null,
          weightUpperBoundPct: 0.01,
          weightRaw: '<0.01%',
          shares: 1000
        },
        {
          code: '3264',
          name: '欣銓',
          sector: '半導體業',
          market: '上櫃',
          weightPct: null,
          weightUpperBoundPct: 0.01,
          weightRaw: '<0.01%',
          shares: 1000
        },
        {
          code: '2481',
          name: '強茂',
          sector: '半導體業',
          market: '上市',
          weightPct: null,
          weightUpperBoundPct: 0.01,
          weightRaw: '<0.01%',
          shares: 5000
        }
      ],
      currentComplete: true
    },
    {
      etf: '00403A',
      date: '2026-10-13',
      sourceUrl: 'https://act-etf.fundmeow.com/#tab=etf',
      note: '10/13官方完整表已核對；官方表51筆，與第三方證券代碼及一般權重一致。11筆官方權重四捨五入為0.00%，但股數為正；第三方標示低於0.01%。 分類依2026/10/12 TWSE／TPEx公司產業，非研究業務板塊。已列全部網站股票列；低於0.01%未補零，餘額不視為現金。',
      rows: [
        {
          code: '2330',
          name: '台積電',
          sector: '半導體業',
          market: '上市',
          weightPct: 13.81,
          weightUpperBoundPct: null,
          weightRaw: '13.81%',
          shares: 7700000
        },
        {
          code: '2454',
          name: '聯發科',
          sector: '半導體業',
          market: '上市',
          weightPct: 6.35,
          weightUpperBoundPct: null,
          weightRaw: '6.35%',
          shares: 1950000
        },
        {
          code: '3037',
          name: '欣興',
          sector: '電子零組件業',
          market: '上市',
          weightPct: 5.95,
          weightUpperBoundPct: null,
          weightRaw: '5.95%',
          shares: 7000000
        },
        {
          code: '3653',
          name: '健策',
          sector: '電子零組件業',
          market: '上市',
          weightPct: 5.61,
          weightUpperBoundPct: null,
          weightRaw: '5.61%',
          shares: 1115000
        },
        {
          code: '2383',
          name: '台光電',
          sector: '電子零組件業',
          market: '上市',
          weightPct: 5.59,
          weightUpperBoundPct: null,
          weightRaw: '5.59%',
          shares: 1400000
        },
        {
          code: '3017',
          name: '奇鋐',
          sector: '電腦及週邊業',
          market: '上市',
          weightPct: 4.96,
          weightUpperBoundPct: null,
          weightRaw: '4.96%',
          shares: 2100000
        },
        {
          code: '6223',
          name: '旺矽',
          sector: '半導體業',
          market: '上櫃',
          weightPct: 3.98,
          weightUpperBoundPct: null,
          weightRaw: '3.98%',
          shares: 930000
        },
        {
          code: '2327',
          name: '國巨*',
          sector: '電子零組件業',
          market: '上市',
          weightPct: 3.8,
          weightUpperBoundPct: null,
          weightRaw: '3.80%',
          shares: 8800000
        },
        {
          code: '3443',
          name: '創意',
          sector: '半導體業',
          market: '上市',
          weightPct: 3.73,
          weightUpperBoundPct: null,
          weightRaw: '3.73%',
          shares: 640000
        },
        {
          code: '2308',
          name: '台達電',
          sector: '電子零組件業',
          market: '上市',
          weightPct: 3.71,
          weightUpperBoundPct: null,
          weightRaw: '3.71%',
          shares: 2900000
        },
        {
          code: '3189',
          name: '景碩',
          sector: '半導體業',
          market: '上市',
          weightPct: 3.33,
          weightUpperBoundPct: null,
          weightRaw: '3.33%',
          shares: 4450000
        },
        {
          code: '8046',
          name: '南電',
          sector: '電子零組件業',
          market: '上市',
          weightPct: 3.12,
          weightUpperBoundPct: null,
          weightRaw: '3.12%',
          shares: 3010000
        },
        {
          code: '6669',
          name: '緯穎',
          sector: '電腦及週邊業',
          market: '上市',
          weightPct: 2.68,
          weightUpperBoundPct: null,
          weightRaw: '2.68%',
          shares: 1697956
        },
        {
          code: '1303',
          name: '南亞',
          sector: '塑膠工業',
          market: '上市',
          weightPct: 2.64,
          weightUpperBoundPct: null,
          weightRaw: '2.64%',
          shares: 11500000
        },
        {
          code: '6274',
          name: '台燿',
          sector: '電子零組件業',
          market: '上櫃',
          weightPct: 2.5,
          weightUpperBoundPct: null,
          weightRaw: '2.50%',
          shares: 2100000
        },
        {
          code: '3665',
          name: '貿聯-KY',
          sector: '其他電子業',
          market: '上市',
          weightPct: 2.38,
          weightUpperBoundPct: null,
          weightRaw: '2.38%',
          shares: 1460000
        },
        {
          code: '2345',
          name: '智邦',
          sector: '通信網路業',
          market: '上市',
          weightPct: 2.35,
          weightUpperBoundPct: null,
          weightRaw: '2.35%',
          shares: 1600000
        },
        {
          code: '8996',
          name: '高力',
          sector: '電機機械',
          market: '上市',
          weightPct: 2.32,
          weightUpperBoundPct: null,
          weightRaw: '2.32%',
          shares: 1880000
        },
        {
          code: '2303',
          name: '聯電',
          sector: '半導體業',
          market: '上市',
          weightPct: 2.04,
          weightUpperBoundPct: null,
          weightRaw: '2.04%',
          shares: 20000000
        },
        {
          code: '3008',
          name: '大立光',
          sector: '光電業',
          market: '上市',
          weightPct: 1.75,
          weightUpperBoundPct: null,
          weightRaw: '1.75%',
          shares: 335000
        },
        {
          code: '5274',
          name: '信驊',
          sector: '半導體業',
          market: '上櫃',
          weightPct: 1.47,
          weightUpperBoundPct: null,
          weightRaw: '1.47%',
          shares: 117500
        },
        {
          code: '2408',
          name: '南亞科',
          sector: '半導體業',
          market: '上市',
          weightPct: 0.98,
          weightUpperBoundPct: null,
          weightRaw: '0.98%',
          shares: 2800000
        },
        {
          code: '2449',
          name: '京元電子',
          sector: '半導體業',
          market: '上市',
          weightPct: 0.88,
          weightUpperBoundPct: null,
          weightRaw: '0.88%',
          shares: 4000000
        },
        {
          code: '2317',
          name: '鴻海',
          sector: '其他電子業',
          market: '上市',
          weightPct: 0.55,
          weightUpperBoundPct: null,
          weightRaw: '0.55%',
          shares: 3200000
        },
        {
          code: '2059',
          name: '川湖',
          sector: '電子零組件業',
          market: '上市',
          weightPct: 0.54,
          weightUpperBoundPct: null,
          weightRaw: '0.54%',
          shares: 75000
        },
        {
          code: '3211',
          name: '順達',
          sector: '電腦及週邊業',
          market: '上櫃',
          weightPct: 0.52,
          weightUpperBoundPct: null,
          weightRaw: '0.52%',
          shares: 2000000
        },
        {
          code: '3450',
          name: '聯鈞',
          sector: '半導體業',
          market: '上市',
          weightPct: 0.51,
          weightUpperBoundPct: null,
          weightRaw: '0.51%',
          shares: 1500000
        },
        {
          code: '6442',
          name: '光聖',
          sector: '通信網路業',
          market: '上市',
          weightPct: 0.41,
          weightUpperBoundPct: null,
          weightRaw: '0.41%',
          shares: 350000
        },
        {
          code: '3583',
          name: '辛耘',
          sector: '半導體業',
          market: '上市',
          weightPct: 0.41,
          weightUpperBoundPct: null,
          weightRaw: '0.41%',
          shares: 800000
        },
        {
          code: '2368',
          name: '金像電',
          sector: '電子零組件業',
          market: '上市',
          weightPct: 0.4,
          weightUpperBoundPct: null,
          weightRaw: '0.40%',
          shares: 480000
        },
        {
          code: '2882',
          name: '國泰金',
          sector: '金融業',
          market: '上市',
          weightPct: 0.33,
          weightUpperBoundPct: null,
          weightRaw: '0.33%',
          shares: 4000000
        },
        {
          code: '6805',
          name: '富世達',
          sector: '電子零組件業',
          market: '上市',
          weightPct: 0.27,
          weightUpperBoundPct: null,
          weightRaw: '0.27%',
          shares: 170000
        },
        {
          code: '6488',
          name: '環球晶',
          sector: '半導體業',
          market: '上櫃',
          weightPct: 0.22,
          weightUpperBoundPct: null,
          weightRaw: '0.22%',
          shares: 300000
        },
        {
          code: '2313',
          name: '華通',
          sector: '電子零組件業',
          market: '上市',
          weightPct: 0.21,
          weightUpperBoundPct: null,
          weightRaw: '0.21%',
          shares: 1200000
        },
        {
          code: '1560',
          name: '中砂',
          sector: '電機機械',
          market: '上市',
          weightPct: 0.13,
          weightUpperBoundPct: null,
          weightRaw: '0.13%',
          shares: 191000
        },
        {
          code: '2481',
          name: '強茂',
          sector: '半導體業',
          market: '上市',
          weightPct: 0.08,
          weightUpperBoundPct: null,
          weightRaw: '0.08%',
          shares: 700000
        },
        {
          code: '2455',
          name: '全新',
          sector: '通信網路業',
          market: '上市',
          weightPct: 0.07,
          weightUpperBoundPct: null,
          weightRaw: '0.07%',
          shares: 200000
        },
        {
          code: '2301',
          name: '光寶科',
          sector: '電腦及週邊業',
          market: '上市',
          weightPct: 0.06,
          weightUpperBoundPct: null,
          weightRaw: '0.06%',
          shares: 300000
        },
        {
          code: '6285',
          name: '啟碁',
          sector: '通信網路業',
          market: '上市',
          weightPct: 0.06,
          weightUpperBoundPct: null,
          weightRaw: '0.06%',
          shares: 350000
        },
        {
          code: '1717',
          name: '長興',
          sector: '化學工業',
          market: '上市',
          weightPct: 0.05,
          weightUpperBoundPct: null,
          weightRaw: '0.05%',
          shares: 900000
        },
        {
          code: '3264',
          name: '欣銓',
          sector: '半導體業',
          market: '上櫃',
          weightPct: null,
          weightUpperBoundPct: 0.01,
          weightRaw: '<0.01%',
          shares: 1000
        },
        {
          code: '8358',
          name: '金居',
          sector: '電子零組件業',
          market: '上櫃',
          weightPct: null,
          weightUpperBoundPct: 0.01,
          weightRaw: '<0.01%',
          shares: 1000
        },
        {
          code: '8299',
          name: '群聯',
          sector: '半導體業',
          market: '上櫃',
          weightPct: null,
          weightUpperBoundPct: 0.01,
          weightRaw: '<0.01%',
          shares: 1000
        },
        {
          code: '6196',
          name: '帆宣',
          sector: '其他電子業',
          market: '上市',
          weightPct: null,
          weightUpperBoundPct: 0.01,
          weightRaw: '<0.01%',
          shares: 1000
        },
        {
          code: '6239',
          name: '力成',
          sector: '半導體業',
          market: '上市',
          weightPct: null,
          weightUpperBoundPct: 0.01,
          weightRaw: '<0.01%',
          shares: 1000
        },
        {
          code: '2049',
          name: '上銀',
          sector: '電機機械',
          market: '上市',
          weightPct: null,
          weightUpperBoundPct: 0.01,
          weightRaw: '<0.01%',
          shares: 1000
        },
        {
          code: '2360',
          name: '致茂',
          sector: '其他電子業',
          market: '上市',
          weightPct: null,
          weightUpperBoundPct: 0.01,
          weightRaw: '<0.01%',
          shares: 1000
        },
        {
          code: '2404',
          name: '漢唐',
          sector: '其他電子業',
          market: '上市',
          weightPct: null,
          weightUpperBoundPct: 0.01,
          weightRaw: '<0.01%',
          shares: 1000
        },
        {
          code: '7769',
          name: '鴻勁',
          sector: '半導體業',
          market: '上市',
          weightPct: null,
          weightUpperBoundPct: 0.01,
          weightRaw: '<0.01%',
          shares: 1000
        },
        {
          code: '2344',
          name: '華邦電',
          sector: '半導體業',
          market: '上市',
          weightPct: null,
          weightUpperBoundPct: 0.01,
          weightRaw: '<0.01%',
          shares: 1000
        },
        {
          code: '3711',
          name: '日月光投控',
          sector: '半導體業',
          market: '上市',
          weightPct: null,
          weightUpperBoundPct: 0.01,
          weightRaw: '<0.01%',
          shares: 1000
        }
      ],
      currentComplete: true
    },
    {
      etf: '00991A',
      date: '2026-10-13',
      sourceUrl: 'https://act-etf.fundmeow.com/#tab=etf',
      note: '第三方10/13完整表；官方同日待確認；已展開來源50筆；29筆只公布低於0.01%。復華官方頁本次可讀日期仍為10/12，未取得10/13完整官方表，不能用10/12權重填入。 分類依2026/10/12 TWSE／TPEx公司產業，非研究業務板塊。已列全部網站股票列；低於0.01%未補零，餘額不視為現金。',
      rows: [
        {
          code: '2330',
          name: '台積電',
          sector: '半導體業',
          market: '上市',
          weightPct: 14.03,
          weightUpperBoundPct: null,
          weightRaw: '14.03%',
          shares: null
        },
        {
          code: '2383',
          name: '台光電',
          sector: '電子零組件業',
          market: '上市',
          weightPct: 10.04,
          weightUpperBoundPct: null,
          weightRaw: '10.04%',
          shares: null
        },
        {
          code: '3037',
          name: '欣興',
          sector: '電子零組件業',
          market: '上市',
          weightPct: 8.47,
          weightUpperBoundPct: null,
          weightRaw: '8.47%',
          shares: null
        },
        {
          code: '2408',
          name: '南亞科',
          sector: '半導體業',
          market: '上市',
          weightPct: 7.66,
          weightUpperBoundPct: null,
          weightRaw: '7.66%',
          shares: null
        },
        {
          code: '8046',
          name: '南電',
          sector: '電子零組件業',
          market: '上市',
          weightPct: 6.57,
          weightUpperBoundPct: null,
          weightRaw: '6.57%',
          shares: null
        },
        {
          code: '3189',
          name: '景碩',
          sector: '半導體業',
          market: '上市',
          weightPct: 6.45,
          weightUpperBoundPct: null,
          weightRaw: '6.45%',
          shares: null
        },
        {
          code: '2454',
          name: '聯發科',
          sector: '半導體業',
          market: '上市',
          weightPct: 6.38,
          weightUpperBoundPct: null,
          weightRaw: '6.38%',
          shares: null
        },
        {
          code: '2059',
          name: '川湖',
          sector: '電子零組件業',
          market: '上市',
          weightPct: 6.34,
          weightUpperBoundPct: null,
          weightRaw: '6.34%',
          shares: null
        },
        {
          code: '3017',
          name: '奇鋐',
          sector: '電腦及週邊業',
          market: '上市',
          weightPct: 5.5,
          weightUpperBoundPct: null,
          weightRaw: '5.50%',
          shares: null
        },
        {
          code: '2327',
          name: '國巨*',
          sector: '電子零組件業',
          market: '上市',
          weightPct: 4.66,
          weightUpperBoundPct: null,
          weightRaw: '4.66%',
          shares: null
        },
        {
          code: '1303',
          name: '南亞',
          sector: '塑膠工業',
          market: '上市',
          weightPct: 3.72,
          weightUpperBoundPct: null,
          weightRaw: '3.72%',
          shares: null
        },
        {
          code: '6669',
          name: '緯穎',
          sector: '電腦及週邊業',
          market: '上市',
          weightPct: 3.39,
          weightUpperBoundPct: null,
          weightRaw: '3.39%',
          shares: null
        },
        {
          code: '3081',
          name: '聯亞',
          sector: '通信網路業',
          market: '上櫃',
          weightPct: 2.93,
          weightUpperBoundPct: null,
          weightRaw: '2.93%',
          shares: null
        },
        {
          code: '3026',
          name: '禾伸堂',
          sector: '電子零組件業',
          market: '上市',
          weightPct: 2.81,
          weightUpperBoundPct: null,
          weightRaw: '2.81%',
          shares: null
        },
        {
          code: '3653',
          name: '健策',
          sector: '電子零組件業',
          market: '上市',
          weightPct: 2.72,
          weightUpperBoundPct: null,
          weightRaw: '2.72%',
          shares: null
        },
        {
          code: '5274',
          name: '信驊',
          sector: '半導體業',
          market: '上櫃',
          weightPct: 2.57,
          weightUpperBoundPct: null,
          weightRaw: '2.57%',
          shares: null
        },
        {
          code: '3711',
          name: '日月光投控',
          sector: '半導體業',
          market: '上市',
          weightPct: 1.69,
          weightUpperBoundPct: null,
          weightRaw: '1.69%',
          shares: null
        },
        {
          code: '6505',
          name: '台塑化',
          sector: '油電燃氣',
          market: '上市',
          weightPct: 1.6,
          weightUpperBoundPct: null,
          weightRaw: '1.60%',
          shares: null
        },
        {
          code: '3008',
          name: '大立光',
          sector: '光電業',
          market: '上市',
          weightPct: 1.07,
          weightUpperBoundPct: null,
          weightRaw: '1.07%',
          shares: null
        },
        {
          code: '6223',
          name: '旺矽',
          sector: '半導體業',
          market: '上櫃',
          weightPct: 0.01,
          weightUpperBoundPct: null,
          weightRaw: '0.01%',
          shares: null
        },
        {
          code: '7769',
          name: '鴻勁',
          sector: '半導體業',
          market: '上市',
          weightPct: 0.01,
          weightUpperBoundPct: null,
          weightRaw: '0.01%',
          shares: null
        },
        {
          code: '2887',
          name: '台新新光金',
          sector: '金融業',
          market: '上市',
          weightPct: null,
          weightUpperBoundPct: 0.01,
          weightRaw: '<0.01%',
          shares: null
        },
        {
          code: '2882',
          name: '國泰金',
          sector: '金融業',
          market: '上市',
          weightPct: null,
          weightUpperBoundPct: 0.01,
          weightRaw: '<0.01%',
          shares: null
        },
        {
          code: '2449',
          name: '京元電子',
          sector: '半導體業',
          market: '上市',
          weightPct: null,
          weightUpperBoundPct: 0.01,
          weightRaw: '<0.01%',
          shares: null
        },
        {
          code: '2884',
          name: '玉山金',
          sector: '金融業',
          market: '上市',
          weightPct: null,
          weightUpperBoundPct: 0.01,
          weightRaw: '<0.01%',
          shares: null
        },
        {
          code: '2885',
          name: '元大金',
          sector: '金融業',
          market: '上市',
          weightPct: null,
          weightUpperBoundPct: 0.01,
          weightRaw: '<0.01%',
          shares: null
        },
        {
          code: '2886',
          name: '兆豐金',
          sector: '金融業',
          market: '上市',
          weightPct: null,
          weightUpperBoundPct: 0.01,
          weightRaw: '<0.01%',
          shares: null
        },
        {
          code: '2891',
          name: '中信金',
          sector: '金融業',
          market: '上市',
          weightPct: null,
          weightUpperBoundPct: 0.01,
          weightRaw: '<0.01%',
          shares: null
        },
        {
          code: '2890',
          name: '永豐金',
          sector: '金融業',
          market: '上市',
          weightPct: null,
          weightUpperBoundPct: 0.01,
          weightRaw: '<0.01%',
          shares: null
        },
        {
          code: '2880',
          name: '華南金',
          sector: '金融業',
          market: '上市',
          weightPct: null,
          weightUpperBoundPct: 0.01,
          weightRaw: '<0.01%',
          shares: null
        },
        {
          code: '3044',
          name: '健鼎',
          sector: '電子零組件業',
          market: '上市',
          weightPct: null,
          weightUpperBoundPct: 0.01,
          weightRaw: '<0.01%',
          shares: null
        },
        {
          code: '3036',
          name: '文曄',
          sector: '電子通路業',
          market: '上市',
          weightPct: null,
          weightUpperBoundPct: 0.01,
          weightRaw: '<0.01%',
          shares: null
        },
        {
          code: '2883',
          name: '凱基金',
          sector: '金融業',
          market: '上市',
          weightPct: null,
          weightUpperBoundPct: 0.01,
          weightRaw: '<0.01%',
          shares: null
        },
        {
          code: '2412',
          name: '中華電',
          sector: '通信網路業',
          market: '上市',
          weightPct: null,
          weightUpperBoundPct: 0.01,
          weightRaw: '<0.01%',
          shares: null
        },
        {
          code: '2379',
          name: '瑞昱',
          sector: '半導體業',
          market: '上市',
          weightPct: null,
          weightUpperBoundPct: 0.01,
          weightRaw: '<0.01%',
          shares: null
        },
        {
          code: '2345',
          name: '智邦',
          sector: '通信網路業',
          market: '上市',
          weightPct: null,
          weightUpperBoundPct: 0.01,
          weightRaw: '<0.01%',
          shares: null
        },
        {
          code: '2357',
          name: '華碩',
          sector: '電腦及週邊業',
          market: '上市',
          weightPct: null,
          weightUpperBoundPct: 0.01,
          weightRaw: '<0.01%',
          shares: null
        },
        {
          code: '2308',
          name: '台達電',
          sector: '電子零組件業',
          market: '上市',
          weightPct: null,
          weightUpperBoundPct: 0.01,
          weightRaw: '<0.01%',
          shares: null
        },
        {
          code: '2303',
          name: '聯電',
          sector: '半導體業',
          market: '上市',
          weightPct: null,
          weightUpperBoundPct: 0.01,
          weightRaw: '<0.01%',
          shares: null
        },
        {
          code: '2881',
          name: '富邦金',
          sector: '金融業',
          market: '上市',
          weightPct: null,
          weightUpperBoundPct: 0.01,
          weightRaw: '<0.01%',
          shares: null
        },
        {
          code: '3231',
          name: '緯創',
          sector: '電腦及週邊業',
          market: '上市',
          weightPct: null,
          weightUpperBoundPct: 0.01,
          weightRaw: '<0.01%',
          shares: null
        },
        {
          code: '5347',
          name: '世界',
          sector: '半導體業',
          market: '上櫃',
          weightPct: null,
          weightUpperBoundPct: 0.01,
          weightRaw: '<0.01%',
          shares: null
        },
        {
          code: '6274',
          name: '台燿',
          sector: '電子零組件業',
          market: '上櫃',
          weightPct: null,
          weightUpperBoundPct: 0.01,
          weightRaw: '<0.01%',
          shares: null
        },
        {
          code: '8299',
          name: '群聯',
          sector: '半導體業',
          market: '上櫃',
          weightPct: null,
          weightUpperBoundPct: 0.01,
          weightRaw: '<0.01%',
          shares: null
        },
        {
          code: '3665',
          name: '貿聯-KY',
          sector: '其他電子業',
          market: '上市',
          weightPct: null,
          weightUpperBoundPct: 0.01,
          weightRaw: '<0.01%',
          shares: null
        },
        {
          code: '2317',
          name: '鴻海',
          sector: '其他電子業',
          market: '上市',
          weightPct: null,
          weightUpperBoundPct: 0.01,
          weightRaw: '<0.01%',
          shares: null
        },
        {
          code: '2603',
          name: '長榮',
          sector: '航運業',
          market: '上市',
          weightPct: null,
          weightUpperBoundPct: 0.01,
          weightRaw: '<0.01%',
          shares: null
        },
        {
          code: '2360',
          name: '致茂',
          sector: '其他電子業',
          market: '上市',
          weightPct: null,
          weightUpperBoundPct: 0.01,
          weightRaw: '<0.01%',
          shares: null
        },
        {
          code: '2382',
          name: '廣達',
          sector: '電腦及週邊業',
          market: '上市',
          weightPct: null,
          weightUpperBoundPct: 0.01,
          weightRaw: '<0.01%',
          shares: null
        },
        {
          code: '2313',
          name: '華通',
          sector: '電子零組件業',
          market: '上市',
          weightPct: null,
          weightUpperBoundPct: 0.01,
          weightRaw: '<0.01%',
          shares: null
        }
      ],
      currentComplete: true
    },
    {
      etf: '00406A',
      date: '2026-10-13',
      sourceUrl: 'https://act-etf.fundmeow.com/#tab=etf',
      note: '第三方10/13完整表；官方同日待確認；已展開來源61筆；1筆只公布低於0.01%。官方基金頁本次讀取失敗，10/13完整官方表尚未取得。股票以外資產及衍生工具未在此拆解。 分類依2026/10/12 TWSE／TPEx公司產業，非研究業務板塊。已列全部網站股票列；低於0.01%未補零，餘額不視為現金。',
      rows: [
        {
          code: '2330',
          name: '台積電',
          sector: '半導體業',
          market: '上市',
          weightPct: 9.36,
          weightUpperBoundPct: null,
          weightRaw: '9.36%',
          shares: null
        },
        {
          code: '2383',
          name: '台光電',
          sector: '電子零組件業',
          market: '上市',
          weightPct: 6.25,
          weightUpperBoundPct: null,
          weightRaw: '6.25%',
          shares: null
        },
        {
          code: '2454',
          name: '聯發科',
          sector: '半導體業',
          market: '上市',
          weightPct: 5.77,
          weightUpperBoundPct: null,
          weightRaw: '5.77%',
          shares: null
        },
        {
          code: '3037',
          name: '欣興',
          sector: '電子零組件業',
          market: '上市',
          weightPct: 5.71,
          weightUpperBoundPct: null,
          weightRaw: '5.71%',
          shares: null
        },
        {
          code: '3017',
          name: '奇鋐',
          sector: '電腦及週邊業',
          market: '上市',
          weightPct: 5.16,
          weightUpperBoundPct: null,
          weightRaw: '5.16%',
          shares: null
        },
        {
          code: '3653',
          name: '健策',
          sector: '電子零組件業',
          market: '上市',
          weightPct: 3.75,
          weightUpperBoundPct: null,
          weightRaw: '3.75%',
          shares: null
        },
        {
          code: '2345',
          name: '智邦',
          sector: '通信網路業',
          market: '上市',
          weightPct: 3.44,
          weightUpperBoundPct: null,
          weightRaw: '3.44%',
          shares: null
        },
        {
          code: '6223',
          name: '旺矽',
          sector: '半導體業',
          market: '上櫃',
          weightPct: 3.15,
          weightUpperBoundPct: null,
          weightRaw: '3.15%',
          shares: null
        },
        {
          code: '8046',
          name: '南電',
          sector: '電子零組件業',
          market: '上市',
          weightPct: 3.05,
          weightUpperBoundPct: null,
          weightRaw: '3.05%',
          shares: null
        },
        {
          code: '2308',
          name: '台達電',
          sector: '電子零組件業',
          market: '上市',
          weightPct: 2.64,
          weightUpperBoundPct: null,
          weightRaw: '2.64%',
          shares: null
        },
        {
          code: '5274',
          name: '信驊',
          sector: '半導體業',
          market: '上櫃',
          weightPct: 2.32,
          weightUpperBoundPct: null,
          weightRaw: '2.32%',
          shares: null
        },
        {
          code: '3665',
          name: '貿聯-KY',
          sector: '其他電子業',
          market: '上市',
          weightPct: 2.31,
          weightUpperBoundPct: null,
          weightRaw: '2.31%',
          shares: null
        },
        {
          code: '3711',
          name: '日月光投控',
          sector: '半導體業',
          market: '上市',
          weightPct: 2.3,
          weightUpperBoundPct: null,
          weightRaw: '2.30%',
          shares: null
        },
        {
          code: '3443',
          name: '創意',
          sector: '半導體業',
          market: '上市',
          weightPct: 2.22,
          weightUpperBoundPct: null,
          weightRaw: '2.22%',
          shares: null
        },
        {
          code: '6669',
          name: '緯穎',
          sector: '電腦及週邊業',
          market: '上市',
          weightPct: 2.07,
          weightUpperBoundPct: null,
          weightRaw: '2.07%',
          shares: null
        },
        {
          code: '2303',
          name: '聯電',
          sector: '半導體業',
          market: '上市',
          weightPct: 1.83,
          weightUpperBoundPct: null,
          weightRaw: '1.83%',
          shares: null
        },
        {
          code: '3189',
          name: '景碩',
          sector: '半導體業',
          market: '上市',
          weightPct: 1.7,
          weightUpperBoundPct: null,
          weightRaw: '1.70%',
          shares: null
        },
        {
          code: '2327',
          name: '國巨*',
          sector: '電子零組件業',
          market: '上市',
          weightPct: 1.59,
          weightUpperBoundPct: null,
          weightRaw: '1.59%',
          shares: null
        },
        {
          code: '6274',
          name: '台燿',
          sector: '電子零組件業',
          market: '上櫃',
          weightPct: 1.51,
          weightUpperBoundPct: null,
          weightRaw: '1.51%',
          shares: null
        },
        {
          code: '2360',
          name: '致茂',
          sector: '其他電子業',
          market: '上市',
          weightPct: 1.24,
          weightUpperBoundPct: null,
          weightRaw: '1.24%',
          shares: null
        },
        {
          code: '6510',
          name: '精測',
          sector: '半導體業',
          market: '上櫃',
          weightPct: 1.19,
          weightUpperBoundPct: null,
          weightRaw: '1.19%',
          shares: null
        },
        {
          code: '2059',
          name: '川湖',
          sector: '電子零組件業',
          market: '上市',
          weightPct: 1.07,
          weightUpperBoundPct: null,
          weightRaw: '1.07%',
          shares: null
        },
        {
          code: '2368',
          name: '金像電',
          sector: '電子零組件業',
          market: '上市',
          weightPct: 0.95,
          weightUpperBoundPct: null,
          weightRaw: '0.95%',
          shares: null
        },
        {
          code: '1303',
          name: '南亞',
          sector: '塑膠工業',
          market: '上市',
          weightPct: 0.9,
          weightUpperBoundPct: null,
          weightRaw: '0.90%',
          shares: null
        },
        {
          code: '4958',
          name: '臻鼎-KY',
          sector: '電子零組件業',
          market: '上市',
          weightPct: 0.9,
          weightUpperBoundPct: null,
          weightRaw: '0.90%',
          shares: null
        },
        {
          code: '3167',
          name: '大量',
          sector: '電機機械',
          market: '上市',
          weightPct: 0.84,
          weightUpperBoundPct: null,
          weightRaw: '0.84%',
          shares: null
        },
        {
          code: '2885',
          name: '元大金',
          sector: '金融業',
          market: '上市',
          weightPct: 0.81,
          weightUpperBoundPct: null,
          weightRaw: '0.81%',
          shares: null
        },
        {
          code: '6147',
          name: '頎邦',
          sector: '半導體業',
          market: '上櫃',
          weightPct: 0.72,
          weightUpperBoundPct: null,
          weightRaw: '0.72%',
          shares: null
        },
        {
          code: '3491',
          name: '昇達科',
          sector: '通信網路業',
          market: '上櫃',
          weightPct: 0.63,
          weightUpperBoundPct: null,
          weightRaw: '0.63%',
          shares: null
        },
        {
          code: '3661',
          name: '世芯-KY',
          sector: '半導體業',
          market: '上市',
          weightPct: 0.54,
          weightUpperBoundPct: null,
          weightRaw: '0.54%',
          shares: null
        },
        {
          code: '1560',
          name: '中砂',
          sector: '電機機械',
          market: '上市',
          weightPct: 0.53,
          weightUpperBoundPct: null,
          weightRaw: '0.53%',
          shares: null
        },
        {
          code: '6213',
          name: '聯茂',
          sector: '電子零組件業',
          market: '上市',
          weightPct: 0.53,
          weightUpperBoundPct: null,
          weightRaw: '0.53%',
          shares: null
        },
        {
          code: '2449',
          name: '京元電子',
          sector: '半導體業',
          market: '上市',
          weightPct: 0.53,
          weightUpperBoundPct: null,
          weightRaw: '0.53%',
          shares: null
        },
        {
          code: '6488',
          name: '環球晶',
          sector: '半導體業',
          market: '上櫃',
          weightPct: 0.5,
          weightUpperBoundPct: null,
          weightRaw: '0.50%',
          shares: null
        },
        {
          code: '6715',
          name: '嘉基',
          sector: '電子零組件業',
          market: '上市',
          weightPct: 0.46,
          weightUpperBoundPct: null,
          weightRaw: '0.46%',
          shares: null
        },
        {
          code: '2317',
          name: '鴻海',
          sector: '其他電子業',
          market: '上市',
          weightPct: 0.44,
          weightUpperBoundPct: null,
          weightRaw: '0.44%',
          shares: null
        },
        {
          code: '6515',
          name: '穎崴',
          sector: '半導體業',
          market: '上市',
          weightPct: 0.41,
          weightUpperBoundPct: null,
          weightRaw: '0.41%',
          shares: null
        },
        {
          code: '3008',
          name: '大立光',
          sector: '光電業',
          market: '上市',
          weightPct: 0.39,
          weightUpperBoundPct: null,
          weightRaw: '0.39%',
          shares: null
        },
        {
          code: '2481',
          name: '強茂',
          sector: '半導體業',
          market: '上市',
          weightPct: 0.39,
          weightUpperBoundPct: null,
          weightRaw: '0.39%',
          shares: null
        },
        {
          code: '3081',
          name: '聯亞',
          sector: '通信網路業',
          market: '上櫃',
          weightPct: 0.35,
          weightUpperBoundPct: null,
          weightRaw: '0.35%',
          shares: null
        },
        {
          code: '8996',
          name: '高力',
          sector: '電機機械',
          market: '上市',
          weightPct: 0.35,
          weightUpperBoundPct: null,
          weightRaw: '0.35%',
          shares: null
        },
        {
          code: '6187',
          name: '萬潤',
          sector: '半導體業',
          market: '上櫃',
          weightPct: 0.34,
          weightUpperBoundPct: null,
          weightRaw: '0.34%',
          shares: null
        },
        {
          code: '7769',
          name: '鴻勁',
          sector: '半導體業',
          market: '上市',
          weightPct: 0.33,
          weightUpperBoundPct: null,
          weightRaw: '0.33%',
          shares: null
        },
        {
          code: '3529',
          name: '力旺',
          sector: '半導體業',
          market: '上櫃',
          weightPct: 0.28,
          weightUpperBoundPct: null,
          weightRaw: '0.28%',
          shares: null
        },
        {
          code: '3363',
          name: '上詮',
          sector: '通信網路業',
          market: '上櫃',
          weightPct: 0.28,
          weightUpperBoundPct: null,
          weightRaw: '0.28%',
          shares: null
        },
        {
          code: '1326',
          name: '台化',
          sector: '塑膠工業',
          market: '上市',
          weightPct: 0.26,
          weightUpperBoundPct: null,
          weightRaw: '0.26%',
          shares: null
        },
        {
          code: '2344',
          name: '華邦電',
          sector: '半導體業',
          market: '上市',
          weightPct: 0.25,
          weightUpperBoundPct: null,
          weightRaw: '0.25%',
          shares: null
        },
        {
          code: '2486',
          name: '一詮',
          sector: '光電業',
          market: '上市',
          weightPct: 0.24,
          weightUpperBoundPct: null,
          weightRaw: '0.24%',
          shares: null
        },
        {
          code: '3264',
          name: '欣銓',
          sector: '半導體業',
          market: '上櫃',
          weightPct: 0.21,
          weightUpperBoundPct: null,
          weightRaw: '0.21%',
          shares: null
        },
        {
          code: '3450',
          name: '聯鈞',
          sector: '半導體業',
          market: '上市',
          weightPct: 0.2,
          weightUpperBoundPct: null,
          weightRaw: '0.20%',
          shares: null
        },
        {
          code: '6531',
          name: '愛普*',
          sector: '半導體業',
          market: '上市',
          weightPct: 0.2,
          weightUpperBoundPct: null,
          weightRaw: '0.20%',
          shares: null
        },
        {
          code: '2886',
          name: '兆豐金',
          sector: '金融業',
          market: '上市',
          weightPct: 0.17,
          weightUpperBoundPct: null,
          weightRaw: '0.17%',
          shares: null
        },
        {
          code: '3105',
          name: '穩懋',
          sector: '半導體業',
          market: '上櫃',
          weightPct: 0.16,
          weightUpperBoundPct: null,
          weightRaw: '0.16%',
          shares: null
        },
        {
          code: '8358',
          name: '金居',
          sector: '電子零組件業',
          market: '上櫃',
          weightPct: 0.15,
          weightUpperBoundPct: null,
          weightRaw: '0.15%',
          shares: null
        },
        {
          code: '2395',
          name: '研華',
          sector: '電腦及週邊業',
          market: '上市',
          weightPct: 0.12,
          weightUpperBoundPct: null,
          weightRaw: '0.12%',
          shares: null
        },
        {
          code: '6285',
          name: '啟碁',
          sector: '通信網路業',
          market: '上市',
          weightPct: 0.11,
          weightUpperBoundPct: null,
          weightRaw: '0.11%',
          shares: null
        },
        {
          code: '8150',
          name: '南茂',
          sector: '半導體業',
          market: '上市',
          weightPct: 0.07,
          weightUpperBoundPct: null,
          weightRaw: '0.07%',
          shares: null
        },
        {
          code: '6139',
          name: '亞翔',
          sector: '其他電子業',
          market: '上市',
          weightPct: 0.07,
          weightUpperBoundPct: null,
          weightRaw: '0.07%',
          shares: null
        },
        {
          code: '3131',
          name: '弘塑',
          sector: '半導體業',
          market: '上櫃',
          weightPct: 0.07,
          weightUpperBoundPct: null,
          weightRaw: '0.07%',
          shares: null
        },
        {
          code: '6805',
          name: '富世達',
          sector: '電子零組件業',
          market: '上市',
          weightPct: 0.06,
          weightUpperBoundPct: null,
          weightRaw: '0.06%',
          shares: null
        },
        {
          code: '3260',
          name: '威剛',
          sector: '半導體業',
          market: '上櫃',
          weightPct: null,
          weightUpperBoundPct: 0.01,
          weightRaw: '<0.01%',
          shares: null
        }
      ],
      currentComplete: true
    },
    {
      etf: '00982A',
      date: '2026-10-13',
      sourceUrl: 'https://act-etf.fundmeow.com/#tab=etf',
      note: '第三方10/13完整表；官方日期落差待釐清；已展開來源56筆；5筆只公布低於0.01%。群益官網實際選取10/13後台積電7.60%、NAV24.34；第三方10/13為7.72%，與官網預設10/14的7.72%、NAV23.45一致。公告日與評價日尚待釐清，以下保留第三方10/13標示，不宣稱官方已確認同日。 分類依2026/10/12 TWSE／TPEx公司產業，非研究業務板塊。已列全部網站股票列；低於0.01%未補零，餘額不視為現金。',
      rows: [
        {
          code: '2330',
          name: '台積電',
          sector: '半導體業',
          market: '上市',
          weightPct: 7.72,
          weightUpperBoundPct: null,
          weightRaw: '7.72%',
          shares: null
        },
        {
          code: '2454',
          name: '聯發科',
          sector: '半導體業',
          market: '上市',
          weightPct: 6.69,
          weightUpperBoundPct: null,
          weightRaw: '6.69%',
          shares: null
        },
        {
          code: '3105',
          name: '穩懋',
          sector: '半導體業',
          market: '上櫃',
          weightPct: 6.38,
          weightUpperBoundPct: null,
          weightRaw: '6.38%',
          shares: null
        },
        {
          code: '6139',
          name: '亞翔',
          sector: '其他電子業',
          market: '上市',
          weightPct: 5.4,
          weightUpperBoundPct: null,
          weightRaw: '5.40%',
          shares: null
        },
        {
          code: '6669',
          name: '緯穎',
          sector: '電腦及週邊業',
          market: '上市',
          weightPct: 4.48,
          weightUpperBoundPct: null,
          weightRaw: '4.48%',
          shares: null
        },
        {
          code: '6531',
          name: '愛普*',
          sector: '半導體業',
          market: '上市',
          weightPct: 3.91,
          weightUpperBoundPct: null,
          weightRaw: '3.91%',
          shares: null
        },
        {
          code: '2360',
          name: '致茂',
          sector: '其他電子業',
          market: '上市',
          weightPct: 3.73,
          weightUpperBoundPct: null,
          weightRaw: '3.73%',
          shares: null
        },
        {
          code: '3008',
          name: '大立光',
          sector: '光電業',
          market: '上市',
          weightPct: 3.67,
          weightUpperBoundPct: null,
          weightRaw: '3.67%',
          shares: null
        },
        {
          code: '2059',
          name: '川湖',
          sector: '電子零組件業',
          market: '上市',
          weightPct: 3.62,
          weightUpperBoundPct: null,
          weightRaw: '3.62%',
          shares: null
        },
        {
          code: '6223',
          name: '旺矽',
          sector: '半導體業',
          market: '上櫃',
          weightPct: 3.59,
          weightUpperBoundPct: null,
          weightRaw: '3.59%',
          shares: null
        },
        {
          code: '4958',
          name: '臻鼎-KY',
          sector: '電子零組件業',
          market: '上市',
          weightPct: 3.5,
          weightUpperBoundPct: null,
          weightRaw: '3.50%',
          shares: null
        },
        {
          code: '2383',
          name: '台光電',
          sector: '電子零組件業',
          market: '上市',
          weightPct: 3.44,
          weightUpperBoundPct: null,
          weightRaw: '3.44%',
          shares: null
        },
        {
          code: '3491',
          name: '昇達科',
          sector: '通信網路業',
          market: '上櫃',
          weightPct: 3.44,
          weightUpperBoundPct: null,
          weightRaw: '3.44%',
          shares: null
        },
        {
          code: '3017',
          name: '奇鋐',
          sector: '電腦及週邊業',
          market: '上市',
          weightPct: 2.45,
          weightUpperBoundPct: null,
          weightRaw: '2.45%',
          shares: null
        },
        {
          code: '6488',
          name: '環球晶',
          sector: '半導體業',
          market: '上櫃',
          weightPct: 2.21,
          weightUpperBoundPct: null,
          weightRaw: '2.21%',
          shares: null
        },
        {
          code: '3265',
          name: '台星科',
          sector: '半導體業',
          market: '上櫃',
          weightPct: 1.79,
          weightUpperBoundPct: null,
          weightRaw: '1.79%',
          shares: null
        },
        {
          code: '2301',
          name: '光寶科',
          sector: '電腦及週邊業',
          market: '上市',
          weightPct: 1.78,
          weightUpperBoundPct: null,
          weightRaw: '1.78%',
          shares: null
        },
        {
          code: '2455',
          name: '全新',
          sector: '通信網路業',
          market: '上市',
          weightPct: 1.56,
          weightUpperBoundPct: null,
          weightRaw: '1.56%',
          shares: null
        },
        {
          code: '6213',
          name: '聯茂',
          sector: '電子零組件業',
          market: '上市',
          weightPct: 1.5,
          weightUpperBoundPct: null,
          weightRaw: '1.50%',
          shares: null
        },
        {
          code: '2303',
          name: '聯電',
          sector: '半導體業',
          market: '上市',
          weightPct: 1.45,
          weightUpperBoundPct: null,
          weightRaw: '1.45%',
          shares: null
        },
        {
          code: '5483',
          name: '中美晶',
          sector: '半導體業',
          market: '上櫃',
          weightPct: 1.42,
          weightUpperBoundPct: null,
          weightRaw: '1.42%',
          shares: null
        },
        {
          code: '2395',
          name: '研華',
          sector: '電腦及週邊業',
          market: '上市',
          weightPct: 1.39,
          weightUpperBoundPct: null,
          weightRaw: '1.39%',
          shares: null
        },
        {
          code: '6274',
          name: '台燿',
          sector: '電子零組件業',
          market: '上櫃',
          weightPct: 1.39,
          weightUpperBoundPct: null,
          weightRaw: '1.39%',
          shares: null
        },
        {
          code: '3231',
          name: '緯創',
          sector: '電腦及週邊業',
          market: '上市',
          weightPct: 1.37,
          weightUpperBoundPct: null,
          weightRaw: '1.37%',
          shares: null
        },
        {
          code: '6214',
          name: '精誠',
          sector: '資訊服務業',
          market: '上市',
          weightPct: 1.34,
          weightUpperBoundPct: null,
          weightRaw: '1.34%',
          shares: null
        },
        {
          code: '8996',
          name: '高力',
          sector: '電機機械',
          market: '上市',
          weightPct: 1.32,
          weightUpperBoundPct: null,
          weightRaw: '1.32%',
          shares: null
        },
        {
          code: '3711',
          name: '日月光投控',
          sector: '半導體業',
          market: '上市',
          weightPct: 1.3,
          weightUpperBoundPct: null,
          weightRaw: '1.30%',
          shares: null
        },
        {
          code: '5274',
          name: '信驊',
          sector: '半導體業',
          market: '上櫃',
          weightPct: 1.25,
          weightUpperBoundPct: null,
          weightRaw: '1.25%',
          shares: null
        },
        {
          code: '2376',
          name: '技嘉',
          sector: '電腦及週邊業',
          market: '上市',
          weightPct: 1.24,
          weightUpperBoundPct: null,
          weightRaw: '1.24%',
          shares: null
        },
        {
          code: '5425',
          name: '台半',
          sector: '半導體業',
          market: '上櫃',
          weightPct: 1.23,
          weightUpperBoundPct: null,
          weightRaw: '1.23%',
          shares: null
        },
        {
          code: '2428',
          name: '興勤',
          sector: '電子零組件業',
          market: '上市',
          weightPct: 1.21,
          weightUpperBoundPct: null,
          weightRaw: '1.21%',
          shares: null
        },
        {
          code: '6239',
          name: '力成',
          sector: '半導體業',
          market: '上市',
          weightPct: 1.14,
          weightUpperBoundPct: null,
          weightRaw: '1.14%',
          shares: null
        },
        {
          code: '3583',
          name: '辛耘',
          sector: '半導體業',
          market: '上市',
          weightPct: 1.13,
          weightUpperBoundPct: null,
          weightRaw: '1.13%',
          shares: null
        },
        {
          code: '2467',
          name: '志聖',
          sector: '電子零組件業',
          market: '上市',
          weightPct: 1.12,
          weightUpperBoundPct: null,
          weightRaw: '1.12%',
          shares: null
        },
        {
          code: '3090',
          name: '日電貿',
          sector: '電子零組件業',
          market: '上市',
          weightPct: 1.1,
          weightUpperBoundPct: null,
          weightRaw: '1.10%',
          shares: null
        },
        {
          code: '2478',
          name: '大毅',
          sector: '電子零組件業',
          market: '上市',
          weightPct: 1.09,
          weightUpperBoundPct: null,
          weightRaw: '1.09%',
          shares: null
        },
        {
          code: '6472',
          name: '保瑞',
          sector: '生技醫療',
          market: '上市',
          weightPct: 0.87,
          weightUpperBoundPct: null,
          weightRaw: '0.87%',
          shares: null
        },
        {
          code: '5536',
          name: '聖暉*',
          sector: '其他電子業',
          market: '上櫃',
          weightPct: 0.82,
          weightUpperBoundPct: null,
          weightRaw: '0.82%',
          shares: null
        },
        {
          code: '6672',
          name: '騰輝電子-KY',
          sector: '電子零組件業',
          market: '上市',
          weightPct: 0.79,
          weightUpperBoundPct: null,
          weightRaw: '0.79%',
          shares: null
        },
        {
          code: '2486',
          name: '一詮',
          sector: '光電業',
          market: '上市',
          weightPct: 0.71,
          weightUpperBoundPct: null,
          weightRaw: '0.71%',
          shares: null
        },
        {
          code: '2377',
          name: '微星',
          sector: '電腦及週邊業',
          market: '上市',
          weightPct: 0.53,
          weightUpperBoundPct: null,
          weightRaw: '0.53%',
          shares: null
        },
        {
          code: '8070',
          name: '長華*',
          sector: '電子通路業',
          market: '上市',
          weightPct: 0.45,
          weightUpperBoundPct: null,
          weightRaw: '0.45%',
          shares: null
        },
        {
          code: '6196',
          name: '帆宣',
          sector: '其他電子業',
          market: '上市',
          weightPct: 0.39,
          weightUpperBoundPct: null,
          weightRaw: '0.39%',
          shares: null
        },
        {
          code: '3617',
          name: '碩天',
          sector: '其他電子業',
          market: '上市',
          weightPct: 0.33,
          weightUpperBoundPct: null,
          weightRaw: '0.33%',
          shares: null
        },
        {
          code: '2476',
          name: '鉅祥',
          sector: '電子零組件業',
          market: '上市',
          weightPct: 0.33,
          weightUpperBoundPct: null,
          weightRaw: '0.33%',
          shares: null
        },
        {
          code: '2885',
          name: '元大金',
          sector: '金融業',
          market: '上市',
          weightPct: 0.31,
          weightUpperBoundPct: null,
          weightRaw: '0.31%',
          shares: null
        },
        {
          code: '6640',
          name: '均華',
          sector: '半導體業',
          market: '上櫃',
          weightPct: 0.31,
          weightUpperBoundPct: null,
          weightRaw: '0.31%',
          shares: null
        },
        {
          code: '6446',
          name: '藥華藥',
          sector: '生技醫療',
          market: '上市',
          weightPct: 0.1,
          weightUpperBoundPct: null,
          weightRaw: '0.10%',
          shares: null
        },
        {
          code: '6177',
          name: '達麗',
          sector: '建材營造',
          market: '上市',
          weightPct: 0.02,
          weightUpperBoundPct: null,
          weightRaw: '0.02%',
          shares: null
        },
        {
          code: '3443',
          name: '創意',
          sector: '半導體業',
          market: '上市',
          weightPct: 0.02,
          weightUpperBoundPct: null,
          weightRaw: '0.02%',
          shares: null
        },
        {
          code: '3529',
          name: '力旺',
          sector: '半導體業',
          market: '上櫃',
          weightPct: 0.01,
          weightUpperBoundPct: null,
          weightRaw: '0.01%',
          shares: null
        },
        {
          code: '4441',
          name: '振大環球',
          sector: '紡織纖維',
          market: '上市',
          weightPct: null,
          weightUpperBoundPct: 0.01,
          weightRaw: '<0.01%',
          shares: null
        },
        {
          code: '8358',
          name: '金居',
          sector: '電子零組件業',
          market: '上櫃',
          weightPct: null,
          weightUpperBoundPct: 0.01,
          weightRaw: '<0.01%',
          shares: null
        },
        {
          code: '1519',
          name: '華城',
          sector: '電機機械',
          market: '上市',
          weightPct: null,
          weightUpperBoundPct: 0.01,
          weightRaw: '<0.01%',
          shares: null
        },
        {
          code: '2886',
          name: '兆豐金',
          sector: '金融業',
          market: '上市',
          weightPct: null,
          weightUpperBoundPct: 0.01,
          weightRaw: '<0.01%',
          shares: null
        },
        {
          code: '2881',
          name: '富邦金',
          sector: '金融業',
          market: '上市',
          weightPct: null,
          weightUpperBoundPct: 0.01,
          weightRaw: '<0.01%',
          shares: null
        }
      ],
      currentComplete: true
    }
  ],
  institutional: {
    date: '2026-10-13',
    marketScope: '全市場金額僅為TWSE上市市場買賣超；個股表是9檔已選觀察股，包含8檔TWSE與1檔TPEx，不代表完整產業。ETF持股差與投信買賣超的定義不同，不能相加。',
    marketUnit: 'TWD',
    stockUnit: 'shares',
    market: {
      foreign: -165290508085,
      trust: 24625145557,
      dealer: -9247031180,
      hedge: -47728908158,
      total: -197641301866
    },
    stocks: [
      {
        code: '2330',
        name: '台積電',
        market: 'TWSE',
        foreignShares: -25641224,
        trustShares: 3005324,
        dealerShares: 122350,
        hedgeShares: 2369389,
        sourceUrl: 'https://www.twse.com.tw/rwd/zh/fund/T86?response=json&date=20261013&selectType=ALLBUT0999'
      },
      {
        code: '2383',
        name: '台光電',
        market: 'TWSE',
        foreignShares: -926533,
        trustShares: -169354,
        dealerShares: 27562,
        hedgeShares: 42706,
        sourceUrl: 'https://www.twse.com.tw/rwd/zh/fund/T86?response=json&date=20261013&selectType=ALLBUT0999'
      },
      {
        code: '3037',
        name: '欣興',
        market: 'TWSE',
        foreignShares: -1725980,
        trustShares: -727200,
        dealerShares: -21331,
        hedgeShares: 163942,
        sourceUrl: 'https://www.twse.com.tw/rwd/zh/fund/T86?response=json&date=20261013&selectType=ALLBUT0999'
      },
      {
        code: '3017',
        name: '奇鋐',
        market: 'TWSE',
        foreignShares: -570373,
        trustShares: 234850,
        dealerShares: -60665,
        hedgeShares: 25136,
        sourceUrl: 'https://www.twse.com.tw/rwd/zh/fund/T86?response=json&date=20261013&selectType=ALLBUT0999'
      },
      {
        code: '8996',
        name: '高力',
        market: 'TWSE',
        foreignShares: -500037,
        trustShares: 967000,
        dealerShares: -50371,
        hedgeShares: -13977,
        sourceUrl: 'https://www.twse.com.tw/rwd/zh/fund/T86?response=json&date=20261013&selectType=ALLBUT0999'
      },
      {
        code: '3008',
        name: '大立光',
        market: 'TWSE',
        foreignShares: -420721,
        trustShares: 593646,
        dealerShares: 25752,
        hedgeShares: -36298,
        sourceUrl: 'https://www.twse.com.tw/rwd/zh/fund/T86?response=json&date=20261013&selectType=ALLBUT0999'
      },
      {
        code: '2481',
        name: '強茂',
        market: 'TWSE',
        foreignShares: 2003565,
        trustShares: -2622000,
        dealerShares: -420965,
        hedgeShares: -68402,
        sourceUrl: 'https://www.twse.com.tw/rwd/zh/fund/T86?response=json&date=20261013&selectType=ALLBUT0999'
      },
      {
        code: '6274',
        name: '台燿',
        market: 'TPEx',
        foreignShares: -202195,
        trustShares: 318000,
        dealerShares: -146209,
        hedgeShares: -75020,
        sourceUrl: 'https://www.tpex.org.tw/www/zh-tw/insti/dailyTrade'
      },
      {
        code: '2377',
        name: '微星',
        market: 'TWSE',
        foreignShares: 1840124,
        trustShares: 481705,
        dealerShares: 1168,
        hedgeShares: 97524,
        sourceUrl: 'https://www.twse.com.tw/rwd/zh/fund/T86?response=json&date=20261013&selectType=ALLBUT0999'
      }
    ],
    sources: [
      {
        label: 'TWSE-stocks',
        url: 'https://www.twse.com.tw/rwd/zh/fund/T86?response=json&date=20261013&selectType=ALLBUT0999',
        eventDate: '2026-10-13'
      },
      {
        label: 'TWSE-total',
        url: 'https://www.twse.com.tw/rwd/zh/fund/BFI82U?response=json&dayDate=20261013&type=day',
        eventDate: '2026-10-13'
      },
      {
        label: 'TPEx-stocks',
        url: 'https://www.tpex.org.tw/www/zh-tw/insti/dailyTrade',
        eventDate: '2026-10-13'
      }
    ]
  }
};
