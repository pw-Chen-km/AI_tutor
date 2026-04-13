'use client';

import { useState } from 'react';
import { Check } from 'lucide-react';
import { PLAN_CONFIG, type PlanType } from '@/lib/db/schema';

// Module name mapping for display
const MODULE_NAMES: Record<string, string> = {
  drills: 'In-Class Drills',
  labs: 'Lab Practices',
  homework: 'Homework',
  exams: 'Exam Generator',
  lecture_rehearsal: 'Lecture Rehearsal',
  exam_evaluation: 'Exam Evaluation',
};

// Get modules for each plan
const getPlanModules = (plan: PlanType): string[] => {
  return [...PLAN_CONFIG[plan].features.modules];
};

const plans = [
  { name: 'Free', planId: 'free' as PlanType, price: '$0', features: ['50K tokens/month', '2 exports/month', 'Basic modules access'], popular: false },
  { name: 'Plus', planId: 'plus' as PlanType, price: '$9.99', features: ['500K tokens/month', '10 exports/month', 'Plus modules access'], popular: false },
  { name: 'Pro', planId: 'pro' as PlanType, price: '$24.99', features: ['2M tokens/month', '50 exports/month', 'Web Search & Enrichment', 'Pro modules access'], popular: true },
  { name: 'Premium', planId: 'premium' as PlanType, price: '$49.99', features: ['10M tokens/month', 'Unlimited exports', 'Web Search & Enrichment', '50 files generation history', 'All modules'], popular: false },
];

export function PricingPlans() {
  const [hoveredPlan, setHoveredPlan] = useState<PlanType | null>(null);

  return (
    <div className="grid md:grid-cols-4 gap-6 max-w-5xl mx-auto">
      {plans.map((plan) => {
        const planModules = getPlanModules(plan.planId);
        
        return (
          <div 
            key={plan.name} 
            className={`relative bg-white rounded-2xl p-6 space-y-4 transition-all duration-300 ${
              plan.popular 
                ? 'border-2 border-blue-500 shadow-xl shadow-blue-100/50 hover:shadow-2xl hover:shadow-blue-200/50 scale-105' 
                : 'border border-slate-200 hover:border-slate-300 hover:shadow-lg'
            }`}
          >
            {plan.popular && (
              <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 px-4 py-1.5 bg-gradient-to-r from-blue-600 to-sky-500 rounded-full text-xs text-white font-semibold shadow-lg">
                Most Popular
              </div>
            )}
            <h3 className="text-lg font-semibold text-slate-900 text-center">{plan.name}</h3>
            <div className="text-4xl font-bold text-slate-900 text-center">
              {plan.price}
              <span className="text-base text-slate-500 font-normal">/mo</span>
            </div>
            <ul className="space-y-3 text-sm text-slate-600 pt-2 text-left">
              {plan.features.map((feature, index) => {
                // Check if this is a modules access feature
                const isModulesFeature = feature.includes('modules access') || feature.includes('All modules');
                const isHovered = hoveredPlan === plan.planId && isModulesFeature;
                
                return (
                  <li 
                    key={index} 
                    className="flex items-start gap-2 relative"
                    onMouseEnter={() => isModulesFeature ? setHoveredPlan(plan.planId) : undefined}
                    onMouseLeave={() => isModulesFeature ? setHoveredPlan(null) : undefined}
                  >
                    <Check className={`w-5 h-5 flex-shrink-0 mt-0.5 ${plan.popular ? 'text-blue-600' : 'text-emerald-500'}`} />
                    <div className="flex-1 text-left">
                      <span className={isModulesFeature ? 'cursor-help underline decoration-dotted' : ''}>
                        {feature}
                      </span>
                      {isHovered && isModulesFeature && (
                        <div className="absolute left-0 bottom-full mb-2 z-[100] bg-slate-900 text-white text-xs rounded-lg shadow-xl p-3 min-w-[200px] border border-slate-700">
                          <div className="font-semibold mb-2 text-white">
                            {plan.planId === 'free' ? 'Basic' : plan.planId === 'plus' ? 'Plus' : plan.planId === 'pro' ? 'Pro' : 'All'} Modules:
                          </div>
                          <ul className="space-y-1.5">
                            {planModules.map((moduleId) => (
                              <li key={moduleId} className="flex items-center gap-2 text-slate-200">
                                <Check className="w-3 h-3 text-emerald-400 flex-shrink-0" />
                                {MODULE_NAMES[moduleId] || moduleId}
                              </li>
                            ))}
                          </ul>
                          <div className="absolute -bottom-1 left-4 w-2 h-2 bg-slate-900 rotate-45 border-r border-b border-slate-700"></div>
                        </div>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </div>
  );
}
