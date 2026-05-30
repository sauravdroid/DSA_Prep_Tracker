import dpFoundations from './dp-foundations-apr26.json'
import dpAdvanced from './dp-advanced-may3.json'
import dpDeferred from './dp-deferred-may12.json'
import mixedPatterns from './mixed-patterns-may18.json'
import linkedList from './linked-list-may25.json'

// Add new plans here as they are created
const ALL_PLANS = [
  dpFoundations,
  dpAdvanced,
  dpDeferred,
  mixedPatterns,
  linkedList,
]

export function getAllPlans() {
  return ALL_PLANS.map(p => {
    const days = p.days || []
    return {
      id: p.id,
      title: p.title,
      description: p.description,
      startDate: p.startDate,
      endDate: days.length > 0 ? days[days.length - 1].date : p.startDate,
      totalNew: days.reduce((s, d) => s + d.newProblems.length, 0),
      totalRev: days.reduce((s, d) => s + d.revisionProblems.length, 0),
      days,
    }
  })
}

export function getPlanById(id) {
  return ALL_PLANS.find(p => p.id === id) || null
}

export function getActivePlanId() {
  return localStorage.getItem('dsa_active_plan') || ALL_PLANS[0]?.id || null
}

export function setActivePlanId(id) {
  localStorage.setItem('dsa_active_plan', id)
}
