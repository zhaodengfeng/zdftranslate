/**
 * 配置版本管理与迁移系统
 * 确保配置升级时平滑过渡，不丢失用户数据
 */

const CONFIG_VERSION = 4;  // 当前配置版本

/**
 * 默认配置
 */
function getDefaultConfig() {
  return {
    version: CONFIG_VERSION,
    enabled: true,
    targetLang: 'zh-CN',
    sourceLang: 'auto',
    displayMode: 'bilingual', // bilingual | replace | hover
    translationService: 'libretranslate',
    autoTranslateYouTube: true,
    autoEnableYouTubeCC: true,
    showFloatingImageExportButton: true,
    showFloatingPdfExportButton: true,
    
    // v2 新增：模型选择
    selectedModels: {
      openai: 'gpt-3.5-turbo',
      kimi: 'moonshot-v1-8k',
      zhipu: 'glm-4-flash',
      aliyun: 'qwen-turbo',
      deepseek: 'deepseek-chat',
      openrouter: 'openai/gpt-4o-mini'
    },
    
    // v3 新增：自定义服务
    customServices: [],
    
    // v4 新增：限流配置
    rateLimitConfig: {
      libretranslate: { capacity: 3, rate: 4 },
      openai: { capacity: 10, rate: 20 },
      default: { capacity: 5, rate: 8 }
    },
    
    // v4 新增：预翻译配置
    preloadConfig: {
      margin: 200,      // 视口下方多少像素开始预翻译
      threshold: 0.1    // 元素可见度阈值（0-1）
    },
    
    apiKeys: {},
    excludedSites: [],
    
    style: {
      translationColor: '#111111',
      translationSize: '0.95em',
      lineSpacing: '1.6',
      backgroundHighlight: false
    }
  };
}

/**
 * 配置迁移函数
 * @param {object} config - 旧配置
 * @returns {object} - 迁移后的新配置
 */
function migrateConfig(config) {
  if (!config) {
    return getDefaultConfig();
  }

  let migrated = { ...config };
  const fromVersion = config.version || 1;

  // v1 -> v2: 添加 selectedModels
  if (fromVersion < 2) {
    migrated.selectedModels = {
      openai: 'gpt-3.5-turbo',
      kimi: 'moonshot-v1-8k',
      zhipu: 'glm-4-flash',
      aliyun: 'qwen-turbo',
      deepseek: 'deepseek-chat',
      openrouter: 'openai/gpt-4o-mini'
    };
    migrated.version = 2;
    console.log('[ZDFTranslate] Config migrated: v1 -> v2');
  }

  // v2 -> v3: 添加自定义服务支持
  if (fromVersion < 3) {
    migrated.customServices = migrated.customServices || [];
    migrated.version = 3;
    console.log('[ZDFTranslate] Config migrated: v2 -> v3');
  }

  // v3 -> v4: 添加限流和预翻译配置
  if (fromVersion < 4) {
    migrated.rateLimitConfig = {
      libretranslate: { capacity: 3, rate: 4 },
      openai: { capacity: 10, rate: 20 },
      default: { capacity: 5, rate: 8 }
    };
    
    migrated.preloadConfig = {
      margin: 200,
      threshold: 0.1
    };
    
    // 确保显示模式包含新选项
    if (!['bilingual', 'replace', 'hover'].includes(migrated.displayMode)) {
      migrated.displayMode = 'bilingual';
    }
    
    migrated.version = 4;
    console.log('[ZDFTranslate] Config migrated: v3 -> v4');
  }

  // 确保版本号正确
  migrated.version = CONFIG_VERSION;
  
  // 合并默认值（防止新增字段缺失）
  const defaults = getDefaultConfig();
  migrated = deepMerge(defaults, migrated);
  
  return migrated;
}

/**
 * 深度合并对象
 * @param {object} target - 目标对象（默认值）
 * @param {object} source - 源对象（用户配置）
 * @returns {object} - 合并后的对象
 */
function deepMerge(target, source) {
  const output = { ...target };
  
  for (const key in source) {
    if (source.hasOwnProperty(key)) {
      if (isObject(source[key]) && isObject(target[key])) {
        output[key] = deepMerge(target[key], source[key]);
      } else if (source[key] !== undefined) {
        output[key] = source[key];
      }
    }
  }
  
  return output;
}

function isObject(item) {
  return item && typeof item === 'object' && !Array.isArray(item);
}

/**
 * 验证配置有效性
 * @param {object} config - 待验证的配置
 * @returns {object} - { valid: boolean, errors: string[] }
 */
function validateConfig(config) {
  const errors = [];
  
  if (!config) {
    return { valid: false, errors: ['配置为空'] };
  }
  
  // 检查必需字段
  if (typeof config.enabled !== 'boolean') {
    errors.push('enabled 必须是布尔值');
  }
  
  if (!config.targetLang || typeof config.targetLang !== 'string') {
    errors.push('targetLang 必须是字符串');
  }
  
  if (!['bilingual', 'replace', 'hover'].includes(config.displayMode)) {
    errors.push('displayMode 必须是 bilingual、replace 或 hover 之一');
  }
  
  // 检查版本
  if (config.version !== CONFIG_VERSION) {
    errors.push(`配置版本不匹配：期望 ${CONFIG_VERSION}，实际 ${config.version}`);
  }
  
  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * 导出配置为 JSON（用于备份）
 * @param {object} config - 当前配置
 * @returns {string} - JSON 字符串
 */
function exportConfig(config) {
  const exportData = {
    ...config,
    exportedAt: new Date().toISOString(),
    extensionVersion: chrome.runtime.getManifest?.()?.version || 'unknown'
  };
  return JSON.stringify(exportData, null, 2);
}

/**
 * 从 JSON 导入配置
 * @param {string} json - JSON 字符串
 * @returns {object} - { success: boolean, config?: object, error?: string }
 */
function importConfig(json) {
  try {
    const data = JSON.parse(json);
    
    // 检查导入的配置版本
    if (data.version > CONFIG_VERSION) {
      return {
        success: false,
        error: `导入的配置版本 (${data.version}) 高于当前支持的版本 (${CONFIG_VERSION})，请升级扩展后重试`
      };
    }
    
    // 移除导出时添加的元数据
    delete data.exportedAt;
    delete data.extensionVersion;
    
    // 迁移到最新版本
    const migrated = migrateConfig(data);
    
    // 验证
    const validation = validateConfig(migrated);
    if (!validation.valid) {
      return {
        success: false,
        error: `配置验证失败：${validation.errors.join(', ')}`
      };
    }
    
    return {
      success: true,
      config: migrated
    };
  } catch (e) {
    return {
      success: false,
      error: `解析 JSON 失败：${e.message}`
    };
  }
}

// 导出（如果支持模块）
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    CONFIG_VERSION,
    getDefaultConfig,
    migrateConfig,
    validateConfig,
    exportConfig,
    importConfig
  };
}
