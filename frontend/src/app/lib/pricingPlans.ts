export type PricingPlan = {
  name: string;
  price: string;
  period: string;
  desc: string;
  features: string[];
  cta: string;
  highlight: boolean;
};

export const pricingPlans: PricingPlan[] = [
  {
    name: "Free",
    price: "$0",
    period: "forever",
    desc: "Get started with the basics — no card needed.",
    features: ["3 documents", "AI summaries", "Basic flashcards", "10 chat messages / day", "Community support"],
    cta: "Get started free",
    highlight: false,
  },
  {
    name: "Pro",
    price: "$12",
    period: "per month",
    desc: "For serious students and researchers.",
    features: [
      "Unlimited documents",
      "AI summaries + export",
      "Adaptive flashcards + quizzes",
      "Unlimited chat",
      "Semantic search",
      "Priority support",
    ],
    cta: "Start 14-day free trial",
    highlight: true,
  },
  {
    name: "Team",
    price: "$38",
    period: "per month",
    desc: "For study groups and cohorts.",
    features: [
      "Everything in Pro",
      "Up to 8 members",
      "Shared document library",
      "Collaborative flashcards",
      "Usage analytics",
      "Dedicated support",
    ],
    cta: "Contact us",
    highlight: false,
  },
];
