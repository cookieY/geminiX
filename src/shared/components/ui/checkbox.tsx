import { Checkbox as CheckboxPrimitive } from "@base-ui/react/checkbox"
import { CheckIcon, MinusIcon } from "lucide-react"

import { cn } from "@/shared/lib/utils"

/**
 * §18.70：半选（indeterminate）态渲染为实心减号，与全选✓明确区分——
 * 全选主控（§18.64步骤/执行人、§18.44弹窗三态等）此前半选也画✓，
 * 视觉上与已全选无法分辨。未选/全选渲染不变（Base UI在indeterminate
 * 时只置data-indeterminate，不带data-checked/unchecked）。
 */
function Checkbox({
  className,
  ...props
}: CheckboxPrimitive.Root.Props) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        "peer size-4 shrink-0 rounded-[4px] border border-input bg-transparent transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 data-[checked]:bg-primary data-[checked]:text-primary-foreground data-[checked]:border-primary data-[indeterminate]:bg-primary data-[indeterminate]:text-primary-foreground data-[indeterminate]:border-primary",
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator
        data-slot="checkbox-indicator"
        className="group/checkbox-indicator flex items-center justify-center text-current"
      >
        <CheckIcon className="size-3.5 group-data-[indeterminate]/checkbox-indicator:hidden" />
        <MinusIcon className="hidden size-3.5 group-data-[indeterminate]/checkbox-indicator:block" />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  )
}

export { Checkbox }
