require('dotenv').config();
var { createClient } = require('@supabase/supabase-js');

var supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

var entries = [
  // === OBJECTIONS (expanded beyond the hardcoded 10) ===
  {
    category: 'objection',
    label: 'I need to talk to my business partner',
    content: 'I completely understand wanting to align with your partner. Quick question -- if your partner was on this call right now and heard everything you heard, what do you think they would say?',
    triggers: ['business partner', 'talk to my partner', 'run it by my partner', 'partner needs to weigh in'],
    metadata: { followUp: 'Similar to spouse objection but for B2B. Get them to role-play the partner conversation.', urgency: 'high' },
  },
  {
    category: 'objection',
    label: 'I had a bad experience with coaching before',
    content: 'I appreciate you sharing that. Most high-performers have invested in something that did not deliver. What specifically was missing from that experience? Because that tells me exactly what you need this time.',
    triggers: ['bad experience', 'coaching before', 'last coach', 'previous program', 'got burned before'],
    metadata: { followUp: 'Let them vent, then position your program as the fix for their specific gap.', urgency: 'high' },
  },
  {
    category: 'objection',
    label: 'I want to start after the holidays / new year',
    content: 'I hear that a lot. But here is what I have noticed -- the people who wait for the perfect time are usually the same ones who are still waiting a year from now. What if we got you started now so you hit the new year already ahead?',
    triggers: ['after the holidays', 'new year', 'after summer', 'next quarter', 'start next month'],
    metadata: { followUp: 'Create urgency by reframing delay as cost. Show them what waiting actually costs.', urgency: 'high' },
  },
  {
    category: 'objection',
    label: 'I need to pray about it / sleep on it',
    content: 'I respect that completely. And I would never rush a decision this important. Can I ask -- what specifically are you hoping clarity on? Sometimes talking it through helps.',
    triggers: ['pray about it', 'sleep on it', 'need to sit with it', 'need clarity', 'meditate on it'],
    metadata: { followUp: 'This is a softer version of think about it. Respect the framing but still isolate the real hesitation.', urgency: 'medium' },
  },
  {
    category: 'objection',
    label: 'How is this different from other programs',
    content: 'Great question. Most programs give you information -- courses, templates, frameworks. We give you implementation. You are not buying knowledge, you are buying the accountability and hands-on support to actually execute. That is the difference.',
    triggers: ['different from', 'how is this different', 'what makes you different', 'why not just', 'other programs'],
    metadata: { followUp: 'Position on implementation over information. Generic programs teach, you do it with them.', urgency: 'medium' },
  },
  {
    category: 'objection',
    label: 'Can I try it for a month first',
    content: 'I get the instinct to test the water. But here is the thing -- real transformation does not happen in 30 days. If I let you in for a month, you would barely scratch the surface, and then judge the whole program on an incomplete experience. That would not be fair to you.',
    triggers: ['try it first', 'trial period', 'test it out', 'month to month', 'no commitment'],
    metadata: { followUp: 'Reframe the request as actually hurting them. Commitment is part of the result.', urgency: 'medium' },
  },

  // === BUYING SIGNALS ===
  {
    category: 'buying_signal',
    label: 'Prospect asking about logistics',
    content: 'They are asking HOW it works, not IF it works. This is a buying signal. Start transitioning to close. Say: "Great question -- let me walk you through exactly how we would get you started."',
    triggers: ['how does it work', 'what does the process look like', 'how do we get started', 'what are the next steps', 'how long is the program'],
    metadata: { followUp: 'Logistics questions mean they are mentally in. Do not over-explain. Move to close.', urgency: 'high' },
  },
  {
    category: 'buying_signal',
    label: 'Prospect projecting themselves into the program',
    content: 'They are seeing themselves in the solution. This is a strong buy signal. Reinforce their vision. Say: "Exactly -- and that is just the beginning. Imagine where you will be 90 days in."',
    triggers: ['when I start', 'once I join', 'if I do this', 'when we begin', 'so I would be able to'],
    metadata: { followUp: 'They are already imagining success. Amplify it and move to close.', urgency: 'high' },
  },
  {
    category: 'buying_signal',
    label: 'Prospect asking about payment options',
    content: 'Payment questions mean they want in. They are solving the HOW, not the IF. Say: "Absolutely -- we have a couple of options. Which works best for you?"',
    triggers: ['payment plan', 'can I pay monthly', 'do you offer financing', 'what are my options', 'can I split it'],
    metadata: { followUp: 'Never re-sell after a payment question. Just answer it and close.', urgency: 'high' },
  },

  // === CLOSING TACTICS ===
  {
    category: 'closing_tactic',
    label: 'Assumptive close',
    content: 'When the prospect is showing buy signals, skip the "so do you want to do this" question. Instead say: "Let me get you set up -- do you prefer the full pay or the payment plan?"',
    triggers: [],
    metadata: { stage: 'close', followUp: 'Use when prospect has given 2+ buying signals. Do not ask if, ask which.' },
  },
  {
    category: 'closing_tactic',
    label: 'Cost of inaction close',
    content: 'When they are on the fence, make the cost of doing nothing tangible. Say: "You told me this problem has been costing you [X] per month. If we solve it in 90 days, that is [3X] you are saving. If you wait another 6 months, that is [6X] gone."',
    triggers: [],
    metadata: { stage: 'close', followUp: 'Use their own numbers against the inaction. Make waiting more expensive than investing.' },
  },
  {
    category: 'closing_tactic',
    label: 'Permission close',
    content: 'When they seem ready but hesitant to say yes. Say: "Based on everything you have shared with me today, it sounds like this is exactly what you have been looking for. Am I wrong about that?"',
    triggers: [],
    metadata: { stage: 'close', followUp: 'Soft close that gets them to confirm their own interest. Hard to say no to.' },
  },

  // === DISCOVERY SCRIPTS ===
  {
    category: 'discovery',
    label: 'Pain amplification question',
    content: 'Dig deeper into their pain before pitching anything. Ask: "You mentioned [problem]. How long has that been going on, and what has it cost you -- not just financially, but in terms of time, stress, missed opportunities?"',
    triggers: [],
    metadata: { stage: 'discovery', followUp: 'Never pitch before the pain is fully excavated. The deeper the pain, the easier the close.' },
  },
  {
    category: 'discovery',
    label: 'Future pacing question',
    content: 'Get them emotionally connected to the outcome. Ask: "If we could solve [their problem] in the next 90 days, what would that mean for your life and business? Paint me a picture."',
    triggers: [],
    metadata: { stage: 'discovery', followUp: 'Let them sell themselves on the vision. Their own words become your closing ammunition.' },
  },
  {
    category: 'discovery',
    label: 'Commitment test question',
    content: 'Test their seriousness before you pitch. Ask: "On a scale of 1-10, how committed are you to solving this problem in the next 90 days? And what is keeping it from being a 10?"',
    triggers: [],
    metadata: { stage: 'discovery', followUp: 'If below 7, dig into why. If 8+, they are ready for the pitch. The gap to 10 reveals the real objection.' },
  },

  // === RAPPORT / OPENER ===
  {
    category: 'rapport',
    label: 'Opening the call strong',
    content: 'Set the frame immediately. Say: "Thanks for jumping on. Before we dive in, let me tell you how this works -- I am going to ask you some questions to understand your situation. If I think I can help, I will tell you exactly how. If not, I will tell you that too. Fair enough?"',
    triggers: [],
    metadata: { stage: 'opener', followUp: 'This sets you up as the authority and removes the salesy vibe. They relax because you are not desperate.' },
  },
];

async function seed() {
  console.log('Seeding knowledge base with ' + entries.length + ' entries...');

  for (var i = 0; i < entries.length; i++) {
    var e = entries[i];
    var result = await supabase
      .from('knowledge_base')
      .insert({
        category: e.category,
        label: e.label,
        content: e.content,
        triggers: e.triggers,
        metadata: e.metadata,
      });

    if (result.error) {
      console.error('Failed to insert: ' + e.label, result.error.message);
    } else {
      console.log('  [' + e.category + '] ' + e.label);
    }
  }

  console.log('\nDone! Knowledge base seeded.');
}

seed();
