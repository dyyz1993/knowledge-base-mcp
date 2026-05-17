import type { ResearchMode, StepName, StepCost } from "./types"
import { STEP_COSTS, MODE_BUDGETS } from "./types"

export class BudgetManager {
  private mode: ResearchMode
  private maxSteps: number
  private maxCost: number
  private usedSteps = 0
  private usedCost = 0
  private warningThreshold = 0.7
  private criticalThreshold = 0.9

  constructor(mode: ResearchMode) {
    this.mode = mode
    const budget = MODE_BUDGETS[mode]
    this.maxSteps = budget.maxSteps
    this.maxCost = budget.maxCost
  }

  canAfford(stepName: StepName): boolean {
    const cost = STEP_COSTS[stepName]
    return this.usedSteps + 1 <= this.maxSteps && this.usedCost + cost.cost <= this.maxCost
  }

  spend(stepName: StepName): void {
    const cost = STEP_COSTS[stepName]
    this.usedSteps++
    this.usedCost += cost.cost
  }

  shouldWarn(): boolean {
    return this.usedCost / this.maxCost >= this.warningThreshold
  }

  isCritical(): boolean {
    return this.usedCost / this.maxCost >= this.criticalThreshold
  }

  remaining(): { steps: number; cost: number } {
    return {
      steps: this.maxSteps - this.usedSteps,
      cost: this.maxCost - this.usedCost,
    }
  }

  getBudget() {
    return {
      used: this.usedSteps,
      max: this.maxSteps,
      usedCost: this.usedCost,
      maxCost: this.maxCost,
    }
  }

  getWarningPrompt(): string {
    if (this.isCritical()) {
      const rem = this.remaining()
      return `⚠️ 研究预算即将耗尽（剩余 ${rem.steps} 步/${rem.cost} 成本）。你必须立即总结当前所有内容，输出最终答案。不要再启动新的搜索或读取。`
    }
    if (this.shouldWarn()) {
      const rem = this.remaining()
      return `⚠️ 你已完成 70% 的研究预算（剩余 ${rem.steps} 步/${rem.cost} 成本）。如果当前内容已足够回答问题，请直接进入总结。如果仍有关键信息缺失，最多再执行 ${Math.min(2, rem.steps)} 步后必须总结。`
    }
    return ""
  }

  getStepModel(stepName: StepName): "small" | "large" | "none" {
    return STEP_COSTS[stepName].model
  }
}
