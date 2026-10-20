import type { PromptToolWriteParameters } from "@/api/generated/client/yearningV4HTTPAPI.schemas";

const PARAM_PLACEHOLDER = /\{\{([a-z][a-z0-9_]*)\}\}/g;

/**
 * §18.80补记1（owner裁定）：技能说明中的{{参数}}占位按行内当前参数值
 * 动态渲染——调参后表格与规则集组合列表的说明即时跟随，与静态种子
 * 解耦。缺失参数（用户自写说明引用了不存在的键）保留占位原样。
 */
export function renderSkillDescription(
  description: string,
  parameters: PromptToolWriteParameters,
): string {
  return description.replace(PARAM_PLACEHOLDER, (raw, key: string) => {
    const value = parameters[key];
    if (value === undefined) return raw;
    return Array.isArray(value) ? value.join(", ") : String(value);
  });
}
