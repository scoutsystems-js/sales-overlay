require('dotenv').config();
var { createClient } = require('@supabase/supabase-js');

var supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

var entries = [

  // =========================================================================
  // MONEY OBJECTION - 8 PHASES
  // =========================================================================
  {
    category: 'objection_framework',
    label: 'Money - Phase 1: Logical Isolation',
    content: 'Ask: "Money aside, would you do it?" Wait for YES. Then: "Why would you though?" Let them sell themselves on the value. Then isolate: "Right, so is it a logistical thing where this is going to make you completely broke? Or is it something else?"',
    triggers: ['cannot afford', "can't afford", 'too expensive', 'too much money', 'the investment', 'the price'],
    metadata: { framework: 'money', phase: 1, phaseLabel: 'Logical Isolation', objectionId: 'money', nextPhase: 'Money - Phase 2: Binary Identity Creation' },
  },
  {
    category: 'objection_framework',
    label: 'Money - Phase 2: Binary Identity Creation',
    content: 'Say: "There\'s going to be two types of people, right? The guy who says I can\'t so I won\'t. And the guy who says how can I find the money and get resourceful so I can make it happen. Out of those two, which one do you feel like gets where they want to go faster?" Wait for answer. Then: "Why though?" Then: "And which one have you been up until this point in your life?" Let them feel the contradiction. Then: "So what needs to change for you to become the first type of person?"',
    triggers: ['cannot afford', "can't afford", 'too expensive', 'resourceful'],
    metadata: { framework: 'money', phase: 2, phaseLabel: 'Binary Identity Creation', objectionId: 'money', nextPhase: 'Money - Phase 3: Brain Transplant Analogy' },
  },
  {
    category: 'objection_framework',
    label: 'Money - Phase 3: Brain Transplant Analogy',
    content: 'Ask: "What happens if I take an overweight person and give them an athlete\'s brain - what\'s going to happen?" They say: start working out, get in shape. "And what happens if I take an athletic body and put an overweight person\'s brain in it?" They say: get out of shape. "So what determines the results - the current situation or the mindset?" They say: the mindset. Then: "So right now, you have a [current income] person\'s relationship with money, but you want [goal income] results. How\'s that going to work?" Then: "What needs to change first - your bank account, or your brain?"',
    triggers: ['mindset', 'relationship with money', 'brain'],
    metadata: { framework: 'money', phase: 3, phaseLabel: 'Brain Transplant Analogy', objectionId: 'money', nextPhase: 'Money - Phase 4: Historical Pattern Excavation' },
  },
  {
    category: 'objection_framework',
    label: 'Money - Phase 4: Historical Pattern Excavation',
    content: 'Ask: "Has there ever been a time in your life where you didn\'t take advantage of an opportunity because of money, and it ended up biting you later?" Get the YES. "What happened?" Get the full story. "How did that make you feel?" Emotional anchor. "And what did you learn about yourself from that experience?" Self-realization. "So knowing what you know now about how that turned out, what would you tell that version of yourself?" They will say take the opportunity. "So what\'s different about this situation?"',
    triggers: ['missed opportunity', 'regret', 'should have'],
    metadata: { framework: 'money', phase: 4, phaseLabel: 'Historical Pattern Excavation', objectionId: 'money', nextPhase: 'Money - Phase 5: The Mirror of Current Reality' },
  },
  {
    category: 'objection_framework',
    label: 'Money - Phase 5: The Mirror of Current Reality',
    content: 'Ask: "What\'s the reason you got on this call today?" They say to make more money or learn skills. "Right. So you\'re here because you don\'t have the skills yet to make [income goal], correct?" "And why don\'t you have those skills yet? What\'s stopped you from getting them before now?" Listen for excuses. "The way you\'re thinking about this decision right now - is that the same way of thinking that\'s gotten you to where you are today?" "Can you see how that exact way of thinking is the reason why you\'re on this call today instead of already having these skills?" "So if you use the same thinking that got you into this situation to make this decision, where do you think you\'ll be six months from now?" "And how many more calls like this are you going to need to have before you realize that the problem isn\'t the opportunities - it\'s the thinking?"',
    triggers: ['why am i here', 'reason for the call', 'same place'],
    metadata: { framework: 'money', phase: 5, phaseLabel: 'The Mirror of Current Reality', objectionId: 'money', nextPhase: 'Money - Phase 6: The Two Farmers Parable' },
  },
  {
    category: 'objection_framework',
    label: 'Money - Phase 6: The Two Farmers Parable',
    content: 'Tell the parable: "Two farmers during a drought. Both had dying crops. A merchant sold special seeds that grow in harsh conditions but they were expensive. First farmer said I can\'t afford it. Second farmer said I can\'t afford NOT to try it. Six months later, first farmer lost his entire farm. Second farmer had the biggest harvest in the county. The merchant asked him how he found the money. The farmer said I realized I wasn\'t buying seeds - I was buying my future." Then ask: "Which farmer\'s mindset do you identify with more?" And: "Which farmer\'s results do you want?" Then: "So what needs to change about your thinking to get his results?"',
    triggers: ['farmer', 'parable', 'story'],
    metadata: { framework: 'money', phase: 6, phaseLabel: 'The Two Farmers Parable', objectionId: 'money', nextPhase: 'Money - Phase 7: The Resourcefulness Test' },
  },
  {
    category: 'objection_framework',
    label: 'Money - Phase 7: The Resourcefulness Test',
    content: 'Ask: "If your child\'s life depended on you finding this money in the next 48 hours, would you find a way?" They say YES. "Of course you would. Because when something is important enough, we become resourceful. So what does that tell you about your current situation? Is it that you can\'t find the money, or is it that you haven\'t decided this is important enough yet?" Then: "And if that\'s the case, what would need to happen for you to decide that your future is as important as your child\'s life?" Then: "Because that\'s what successful people do - they treat their future like it\'s life or death. Do you?"',
    triggers: ['resourceful', 'find the money', 'important enough'],
    metadata: { framework: 'money', phase: 7, phaseLabel: 'The Resourcefulness Test', objectionId: 'money', nextPhase: 'Money - Phase 8: The Final Mirror' },
  },
  {
    category: 'objection_framework',
    label: 'Money - Phase 8: The Final Mirror',
    content: 'Say: "Here\'s what I know about you from our conversation - you want [their goal], you have the ability to succeed with what we do, and you\'ve confirmed this addresses exactly what\'s been holding you back. Those are facts, right?" Get YES. "So if all of that is true, then what\'s the real investment here - the money, or deciding to finally become the person who can make that money?" Then: "Because you can keep being the person who finds reasons why they can\'t, or you can become the person who finds ways to make it happen. Which person are you going to be?"',
    triggers: ['final', 'decision', 'which person'],
    metadata: { framework: 'money', phase: 8, phaseLabel: 'The Final Mirror', objectionId: 'money', nextPhase: null },
  },

  // =========================================================================
  // TALK TO MY WIFE / SPOUSE - 8 PHASES
  // =========================================================================
  {
    category: 'objection_framework',
    label: 'Spouse - Phase 1: Challenge the Premise',
    content: 'Ask: "How do you know that respecting your wife means you can\'t make a change today to make more money for your family?"',
    triggers: ['talk to my wife', 'talk to my husband', 'talk to my spouse', 'ask my wife'],
    metadata: { framework: 'spouse', phase: 1, phaseLabel: 'Challenge the Premise', objectionId: 'talk-to-spouse', nextPhase: 'Spouse - Phase 2: The Captain\'s Ship Parable' },
  },
  {
    category: 'objection_framework',
    label: 'Spouse - Phase 2: The Captain\'s Ship Parable',
    content: 'Tell the parable: "Two ship captains caught in a storm. First captain called his crew together and asked what should we do. They spent hours debating while the ship drifted toward the rocks. The second captain studied the charts, made a decision, and changed course. When they reached safety, his crew said why didn\'t you ask us? He said because a leader\'s job isn\'t to get permission - it\'s to get results." Then ask: "In your relationship, when it comes to providing for your family, who\'s the captain of that ship?" They say I am. "So are you acting like a captain right now, or like a crew member asking for permission?"',
    triggers: ['captain', 'leader', 'permission'],
    metadata: { framework: 'spouse', phase: 2, phaseLabel: 'The Captain\'s Ship Parable', objectionId: 'talk-to-spouse', nextPhase: 'Spouse - Phase 3: Leadership Identity Interrogation' },
  },
  {
    category: 'objection_framework',
    label: 'Spouse - Phase 3: Leadership Identity Interrogation',
    content: 'Ask: "In your household, when it comes to providing for the family, who\'s ultimately responsible for that?" I am. "And when it comes to making decisions that affect your ability to provide, who should be making those decisions?" I should. "So why are you giving that power to someone else right now?" Let them sit with that. "What do you think that says about you as a leader?"',
    triggers: ['responsible', 'household', 'providing'],
    metadata: { framework: 'spouse', phase: 3, phaseLabel: 'Leadership Identity Interrogation', objectionId: 'talk-to-spouse', nextPhase: 'Spouse - Phase 4: Heavy is the Head' },
  },
  {
    category: 'objection_framework',
    label: 'Spouse - Phase 4: Heavy is the Head',
    content: 'Ask: "You know what they say - Heavy is the head that wears the crown. What do you think that means?" Get their interpretation. "It means being the leader is hard because you have to make the tough decisions that others can\'t or won\'t make. Do you agree?" YES. "So right now, are you wearing the crown, or are you trying to give it to your wife?" Identity crisis moment. "And the man you want to become - the one making [income goal] - does he wear the crown, or does he pass it around?"',
    triggers: ['crown', 'tough decisions', 'leader'],
    metadata: { framework: 'spouse', phase: 4, phaseLabel: 'Heavy is the Head', objectionId: 'talk-to-spouse', nextPhase: 'Spouse - Phase 5: Thinking Pattern Excavation' },
  },
  {
    category: 'objection_framework',
    label: 'Spouse - Phase 5: Thinking Pattern Excavation',
    content: 'Ask: "What\'s the reason you\'re on this call today?" To learn how to close/make more money. "Right. So your current approach isn\'t working, correct?" Correct. "And this conversation we\'re having right now - where you\'re finding reasons why you can\'t move forward - does this feel familiar to you?" Let them recognize the pattern. "How many other opportunities have you had this exact same conversation about?" "Can you see how this way of thinking is exactly why you\'re talking to your wife about money problems instead of coming home with solutions?" "The same mindset that\'s making you hesitate right now - is that the same mindset that\'s gotten you to where you are today?" "So if you make this decision the same way you\'ve made every other decision, where will you be a year from now?"',
    triggers: ['pattern', 'same conversation', 'familiar'],
    metadata: { framework: 'spouse', phase: 5, phaseLabel: 'Thinking Pattern Excavation', objectionId: 'talk-to-spouse', nextPhase: 'Spouse - Phase 6: The Leader\'s Brain Analogy' },
  },
  {
    category: 'objection_framework',
    label: 'Spouse - Phase 6: The Leader\'s Brain Analogy',
    content: 'Ask: "What happens if I take a follower and give them a leader\'s brain - what\'s going to happen?" They\'ll start leading, making decisions. "And what happens if I take someone in a leadership position but give them a follower\'s brain?" They\'d fail, ask for permission. "So what determines whether someone leads or follows - their position, or their mindset?" Their mindset. "Right now, you\'re in the position to lead your family to a better financial future, but are you thinking like a leader or like a follower?"',
    triggers: ['follower', 'leader brain', 'position vs mindset'],
    metadata: { framework: 'spouse', phase: 6, phaseLabel: 'The Leader\'s Brain Analogy', objectionId: 'talk-to-spouse', nextPhase: 'Spouse - Phase 7: Future Projection' },
  },
  {
    category: 'objection_framework',
    label: 'Spouse - Phase 7: Future Projection',
    content: 'Ask: "When you go home to your wife tonight, which conversation do you want to have? A) Honey, I found a way to solve our money problems, and I took action on it. B) Honey, I found a way to solve our money problems, but I need your permission first. Which conversation makes you feel more like a man?" A. "Why?" Let them explain leadership to themselves. "So what\'s stopping you from having conversation A?"',
    triggers: ['go home', 'wife tonight', 'conversation'],
    metadata: { framework: 'spouse', phase: 7, phaseLabel: 'Future Projection', objectionId: 'talk-to-spouse', nextPhase: 'Spouse - Phase 8: The Respect Mirror' },
  },
  {
    category: 'objection_framework',
    label: 'Spouse - Phase 8: The Respect Mirror',
    content: 'Say: "Your wife married a leader, right? Not someone who needs permission to improve their family\'s life?" Right. "So which version of yourself is she going to respect more - the one who takes action when opportunities arise, or the one who hesitates when the family needs him to step up?" Wait. "And which version of yourself do YOU respect more?" Self-respect challenge. "Because here\'s the truth - your wife doesn\'t want to make this decision. She wants to see that the man she married has the courage to make the hard decisions when they matter. Are you going to show her that man, or are you going to disappoint her again? What are you going to do?"',
    triggers: ['respect', 'married', 'courage'],
    metadata: { framework: 'spouse', phase: 8, phaseLabel: 'The Respect Mirror', objectionId: 'talk-to-spouse', nextPhase: null },
  },

  // =========================================================================
  // I NEED TO THINK ABOUT IT - 10 PHASES
  // =========================================================================
  {
    category: 'objection_framework',
    label: 'Think - Phase 1: Challenge the Assumption',
    content: 'Ask: "How do you know that thinking about it longer will lead you to making a better decision?" Wait for their logic. Then: "Has that been true in your experience?"',
    triggers: ['think about it', 'let me think', 'need to think', 'need some time'],
    metadata: { framework: 'think', phase: 1, phaseLabel: 'Challenge the Assumption', objectionId: 'think-about-it', nextPhase: 'Think - Phase 2: Historical Decision Analysis' },
  },
  {
    category: 'objection_framework',
    label: 'Think - Phase 2: Historical Decision Analysis',
    content: 'Ask: "Think about the best decisions you\'ve made in your life - how many of those came from months of analysis versus trusting your gut?" Most were gut decisions. "Why do you think that is?" Get their theory. "And when you\'ve overthought decisions in the past, how has that typically worked out for you?" Let them realize overthinking equals problems. "So what does that tell you about your natural decision-making ability?"',
    triggers: ['gut', 'overthink', 'analyze', 'decisions'],
    metadata: { framework: 'think', phase: 2, phaseLabel: 'Historical Decision Analysis', objectionId: 'think-about-it', nextPhase: 'Think - Phase 3: Analysis Paralysis Parable' },
  },
  {
    category: 'objection_framework',
    label: 'Think - Phase 3: Analysis Paralysis Parable',
    content: 'Tell the study: "They put successful entrepreneurs and failed ones in a room with incomplete information about an investment opportunity. The failed entrepreneurs asked for more data, more time, more certainty. The successful entrepreneurs looked at the available information, made a decision, and started acting. Six months later, the successful entrepreneurs had either succeeded or failed fast and moved on. The failed entrepreneurs were still asking for more information about the original opportunity. Which group do you want to be in?" They say successful. "Is that the way you\'re thinking right now?"',
    triggers: ['entrepreneur', 'data', 'certainty', 'information'],
    metadata: { framework: 'think', phase: 3, phaseLabel: 'Analysis Paralysis Parable', objectionId: 'think-about-it', nextPhase: 'Think - Phase 4: Binary Decision Makers' },
  },
  {
    category: 'objection_framework',
    label: 'Think - Phase 4: Binary Decision Makers',
    content: 'Say: "There are two types of decision makers: People who think their way into action. People who act their way into clarity. Which type gets results faster?" Act their way into clarity. "Why though?" Get their reasoning. "And which type have you been up until now?" Identity realization. "How\'s that been working for you?" Let them feel the failure. "So what type do you need to become?"',
    triggers: ['think into action', 'act into clarity', 'decision maker'],
    metadata: { framework: 'think', phase: 4, phaseLabel: 'Binary Decision Makers', objectionId: 'think-about-it', nextPhase: 'Think - Phase 5: The Overthinking Brain Analogy' },
  },
  {
    category: 'objection_framework',
    label: 'Think - Phase 5: The Overthinking Brain Analogy',
    content: 'Ask: "What happens if I take a successful person and give them an overthinker\'s brain?" They\'d second-guess everything, miss opportunities. "And what happens if I take someone who overthinks everything and give them a successful person\'s brain?" They\'d start taking action. "So what determines success - the circumstances, or the way you think about decisions?" The way you think. "Right now, are you thinking like a successful person or like an overthinker?"',
    triggers: ['overthinker', 'successful brain', 'second guess'],
    metadata: { framework: 'think', phase: 5, phaseLabel: 'The Overthinking Brain Analogy', objectionId: 'think-about-it', nextPhase: 'Think - Phase 6: Pattern Recognition Devastation' },
  },
  {
    category: 'objection_framework',
    label: 'Think - Phase 6: Pattern Recognition Devastation',
    content: 'Ask: "What\'s the real reason you\'re on this call today?" To learn skills/make more money. "You\'re here because you don\'t have the results you want yet. And you don\'t have the results because you don\'t have the skills. And you don\'t have the skills because... what?" Listen. "And this conversation where you\'re coming up with reasons to delay - is this new, or have you had this same conversation before about other opportunities?" Pattern recognition. "Can you see how this exact way of thinking is the reason you\'re sitting here today still needing these skills?" "Every time an opportunity comes up, you find a reason to wait. Where has that gotten you?" Here. "So if you handle this decision the same way, what\'s going to change?" Nothing. "What needs to change - the opportunities, or the way you think about them?"',
    triggers: ['pattern', 'same conversation', 'every time'],
    metadata: { framework: 'think', phase: 6, phaseLabel: 'Pattern Recognition Devastation', objectionId: 'think-about-it', nextPhase: 'Think - Phase 7: The Certainty Trap' },
  },
  {
    category: 'objection_framework',
    label: 'Think - Phase 7: The Certainty Trap',
    content: 'Ask: "What are you really waiting for - more information, or more courage?" Force them to choose. "If it\'s more information, what specific information would change your mind?" They usually cannot answer specifically. "And if it\'s more courage, what would give you that courage?" Lead them to: taking action gives courage. "So which one is it really?"',
    triggers: ['information', 'courage', 'waiting for', 'certainty'],
    metadata: { framework: 'think', phase: 7, phaseLabel: 'The Certainty Trap', objectionId: 'think-about-it', nextPhase: 'Think - Phase 8: The Swimming Pool Analogy' },
  },
  {
    category: 'objection_framework',
    label: 'Think - Phase 8: The Swimming Pool Analogy',
    content: 'Say: "This is like someone standing at the edge of a swimming pool wanting to learn how to swim but saying I need to think about getting in the water first. How do you actually learn to swim?" By getting in. "Exactly. You can study swimming techniques for months but you\'ll never know if you can swim until you jump in. The clarity you\'re looking for? You\'re not going to get that from thinking about it. You\'re going to get that from committing and finding out. So what\'s really going on - do you need to think about it, or do you need to decide what kind of person you\'re going to be?"',
    triggers: ['swimming', 'jump in', 'pool'],
    metadata: { framework: 'think', phase: 8, phaseLabel: 'The Swimming Pool Analogy', objectionId: 'think-about-it', nextPhase: 'Think - Phase 9: The Time Cost Reality' },
  },
  {
    category: 'objection_framework',
    label: 'Think - Phase 9: The Time Cost Reality',
    content: 'Ask: "If you think about this for another month and then decide to do it, where will you be compared to if you decide today?" A month behind. "And how much money does that month cost you in terms of not having the skills yet?" Let them calculate the real cost. "So what\'s really more expensive - this investment, or waiting another month?"',
    triggers: ['month behind', 'time cost', 'waiting'],
    metadata: { framework: 'think', phase: 9, phaseLabel: 'The Time Cost Reality', objectionId: 'think-about-it', nextPhase: 'Think - Phase 10: The Two Paths Close' },
  },
  {
    category: 'objection_framework',
    label: 'Think - Phase 10: The Two Paths Close',
    content: 'Tell the story: "Two guys wanted to learn a skill. Both found the same mentor on the same day. First guy said I need to think about it. Three months later he was ready to start. Second guy started immediately. A year later, the first guy was just getting to where the other guy was three months in. First guy said I wish I had started when you did. Second guy said you could have - we found the mentor on the same day." Then: "There are two types: people who think their way into action and people who act their way into clarity. Every successful person I know is in the second category. Which category has your current approach put you in? And which one is going to get you where you want to be? Right now you get to decide what kind of person you\'re going to be. What\'s that decision going to be?"',
    triggers: ['two paths', 'decide', 'what kind of person'],
    metadata: { framework: 'think', phase: 10, phaseLabel: 'The Two Paths Close', objectionId: 'think-about-it', nextPhase: null },
  },

  // =========================================================================
  // NO TIME - 6 PHASES
  // =========================================================================
  {
    category: 'objection_framework',
    label: 'Time - Phase 1: Priority Challenge',
    content: 'Ask: "When you say you don\'t have time, what are you really saying?" Let them think. "Are you saying you don\'t have time, or that this isn\'t a priority?"',
    triggers: ["don't have time", 'dont have time', 'too busy', 'not enough time'],
    metadata: { framework: 'time', phase: 1, phaseLabel: 'Priority Challenge', objectionId: 'no-time', nextPhase: 'Time - Phase 2: Time Allocation Interrogation' },
  },
  {
    category: 'objection_framework',
    label: 'Time - Phase 2: Time Allocation Interrogation',
    content: 'Ask: "What are you spending your time on right now that\'s more important than changing your financial situation?" Get specific activities. "And how are those activities moving you toward [their goal]?" They\'ll realize they\'re not. "So you have time for things that don\'t get you where you want to go, but not for things that do?" Identity crisis. "What does that say about your priorities?" Then: "Successful people don\'t find time for opportunities - they MAKE time for what matters. Which type of person have you been?" "So if you keep prioritizing the same things that got you to where you are today, where will you be next year?"',
    triggers: ['spending time', 'priorities', 'busy with'],
    metadata: { framework: 'time', phase: 2, phaseLabel: 'Time Allocation Interrogation', objectionId: 'no-time', nextPhase: 'Time - Phase 3: Brain Transplant Analogy' },
  },
  {
    category: 'objection_framework',
    label: 'Time - Phase 3: Brain Transplant Analogy',
    content: 'Ask: "What happens if I take someone who\'s busy all the time and give them a productive person\'s brain?" They\'ll start focusing on what matters. "And what happens if I take someone who\'s highly productive and give them a busy person\'s brain?" They\'d get overwhelmed, waste time on unimportant things. "So what determines results - how much time you have, or how you think about time?" How you think about time. "Right now, are you thinking about time like a successful person or like someone who\'s always busy but never gets ahead?"',
    triggers: ['productive', 'busy person', 'time management'],
    metadata: { framework: 'time', phase: 3, phaseLabel: 'Brain Transplant Analogy', objectionId: 'no-time', nextPhase: 'Time - Phase 4: The Leaky Bucket Parable' },
  },
  {
    category: 'objection_framework',
    label: 'Time - Phase 4: The Leaky Bucket Parable',
    content: 'Tell the parable: "Two men with leaky buckets both needed to carry water from a well. The first man spent all day running back and forth with his leaky bucket, never stopping to fix the holes. He was always busy but never had enough water. The second man spent an hour fixing his bucket, then easily carried all the water he needed in one trip. When the first man saw this, he said I don\'t have time to fix my bucket - I\'m too busy carrying water." Ask: "Which person gets the results they want? Which person are you being right now?"',
    triggers: ['bucket', 'carrying water', 'too busy to fix'],
    metadata: { framework: 'time', phase: 4, phaseLabel: 'The Leaky Bucket Parable', objectionId: 'no-time', nextPhase: 'Time - Phase 5: The Math Mirror' },
  },
  {
    category: 'objection_framework',
    label: 'Time - Phase 5: The Math Mirror',
    content: 'Say: "Here\'s what I know - you\'re spending 40+ hours a week on your current situation, and it\'s not getting you where you want to be. Is that accurate?" Yes. "So you have 40+ hours a week for something that\'s not working, but you don\'t have a few hours a week for something that could change everything?" Logical breakdown. "What would need to change about how you view time to get different results?" "Because the person making [their goal] - how do you think they view time differently than you do?"',
    triggers: ['40 hours', 'hours a week', 'current situation'],
    metadata: { framework: 'time', phase: 5, phaseLabel: 'The Math Mirror', objectionId: 'no-time', nextPhase: 'Time - Phase 6: The Irony Close' },
  },
  {
    category: 'objection_framework',
    label: 'Time - Phase 6: The Irony Close',
    content: 'Say: "What\'s the reason you got on this call today?" To learn skills/be more productive. "Right. So you\'re here because your current approach to time isn\'t working, correct?" Correct. "And you don\'t have time to fix the thing that would give you more time?" Let the irony sink in. "Can you see how that way of thinking is exactly why you\'re on this call today instead of already having the time freedom you want?" "How many more years are you going to let that way of thinking cost you?"',
    triggers: ['time freedom', 'irony', 'fix the thing'],
    metadata: { framework: 'time', phase: 6, phaseLabel: 'The Irony Close', objectionId: 'no-time', nextPhase: null },
  },

  // =========================================================================
  // BUYING SIGNALS (carried over + expanded)
  // =========================================================================
  {
    category: 'buying_signal',
    label: 'Prospect asking about logistics',
    content: 'They are asking HOW it works, not IF. This is a buying signal. Transition to close: "Great question - let me walk you through exactly how we would get you started."',
    triggers: ['how does it work', 'what does the process look like', 'how do we get started', 'what are the next steps', 'how long is the program'],
    metadata: { followUp: 'Logistics questions mean they are mentally in. Do not over-explain. Move to close.', urgency: 'high' },
  },
  {
    category: 'buying_signal',
    label: 'Prospect projecting themselves into the program',
    content: 'They are seeing themselves in the solution. Reinforce their vision: "Exactly - and that is just the beginning. Imagine where you will be 90 days in."',
    triggers: ['when I start', 'once I join', 'if I do this', 'when we begin', 'so I would be able to'],
    metadata: { followUp: 'They are already imagining success. Amplify and move to close.', urgency: 'high' },
  },
  {
    category: 'buying_signal',
    label: 'Prospect asking about payment options',
    content: 'Payment questions mean they want in. Say: "Absolutely - we have a couple of options. Which works best for you?"',
    triggers: ['payment plan', 'can I pay monthly', 'do you offer financing', 'what are my options', 'can I split it'],
    metadata: { followUp: 'Never re-sell after a payment question. Just answer it and close.', urgency: 'high' },
  },

  // =========================================================================
  // CLOSING TACTICS
  // =========================================================================
  {
    category: 'closing_tactic',
    label: 'Assumptive close',
    content: 'Skip the "so do you want to do this" question. Instead say: "Let me get you set up - do you prefer the full pay or the payment plan?"',
    triggers: [],
    metadata: { stage: 'close', followUp: 'Use when prospect has given 2+ buying signals. Do not ask if, ask which.' },
  },
  {
    category: 'closing_tactic',
    label: 'Cost of inaction close',
    content: 'Make doing nothing tangible: "You told me this problem has been costing you [X] per month. If we solve it in 90 days, that is [3X] saved. If you wait another 6 months, that is [6X] gone."',
    triggers: [],
    metadata: { stage: 'close', followUp: 'Use their own numbers. Make waiting more expensive than investing.' },
  },
  {
    category: 'closing_tactic',
    label: 'Permission close',
    content: 'Soft close: "Based on everything you have shared with me today, it sounds like this is exactly what you have been looking for. Am I wrong about that?"',
    triggers: [],
    metadata: { stage: 'close', followUp: 'Gets them to confirm their own interest. Hard to say no to.' },
  },

  // =========================================================================
  // DISCOVERY SCRIPTS
  // =========================================================================
  {
    category: 'discovery',
    label: 'Pain amplification question',
    content: 'Ask: "You mentioned [problem]. How long has that been going on, and what has it cost you - not just financially, but in terms of time, stress, missed opportunities?"',
    triggers: [],
    metadata: { stage: 'discovery', followUp: 'Never pitch before the pain is fully excavated.' },
  },
  {
    category: 'discovery',
    label: 'Future pacing question',
    content: 'Ask: "If we could solve [their problem] in the next 90 days, what would that mean for your life and business? Paint me a picture."',
    triggers: [],
    metadata: { stage: 'discovery', followUp: 'Let them sell themselves on the vision.' },
  },
  {
    category: 'discovery',
    label: 'Commitment test question',
    content: 'Ask: "On a scale of 1-10, how committed are you to solving this problem in the next 90 days? And what is keeping it from being a 10?"',
    triggers: [],
    metadata: { stage: 'discovery', followUp: 'If below 7, dig into why. The gap to 10 reveals the real objection.' },
  },

  // =========================================================================
  // CALL STAGE: INTRODUCTION (60-120 seconds)
  // =========================================================================
  {
    category: 'call_stage',
    label: 'Introduction - Opening the Call',
    content: 'The introduction sets the stage for the next 30 minutes. Cover in 60-120 seconds: Your name, your business, the prospect\'s location, their profession, direct tie to their potential success, and their family situation. This establishes surface level rapport and gains crucial information within 1-2 minutes. Example: "Hey NAME, can you hear me ok? It\'s nice to meet you, my name is CLOSER, I\'m CLIENT\'s VP/Business Partner, where about are you calling me from?"',
    triggers: ['nice to meet you', 'can you hear me', 'where are you calling from', 'what do you do for work'],
    metadata: { stage: 'introduction', stageOrder: 1, followUp: 'Ask about location, profession, then family. Find a commonality. End with "So how can I help?"' },
  },
  {
    category: 'call_stage',
    label: 'Introduction - Location and Profession Tie-In',
    content: 'After getting their location and profession, tie it back to success: "No way, that\'s awesome. We have a network of members in [CITY] doing XYZ business, so you\'ll fit right in." And for profession: "Very cool, our biggest student base comes from a [INDUSTRY] background, seems like everyone in [INDUSTRY] is trying to get into [OFFER INDUSTRY]. Why do you think that is?"',
    triggers: ['where are you from', 'what do you do', 'for work', 'for a living'],
    metadata: { stage: 'introduction', stageOrder: 1, followUp: 'Make them feel like they belong. Then ask about family for deeper rapport.' },
  },

  // =========================================================================
  // CALL STAGE: THE SET (2-3 minutes)
  // =========================================================================
  {
    category: 'call_stage',
    label: 'The Set - Frame Control',
    content: 'The set establishes who controls the call. The closer is the interviewer who asks questions. The prospect is the interviewee who answers and waits for analysis. Say: "If you\'ve got a pen and paper ready, we can jump right into things. The best way we\'ve seen these calls work is to make it all about you. I imagine you\'ve seen our testimonials and reviews online?" This is also the ultimate pre-handle for "I need to think about it."',
    triggers: ['pen and paper', 'jump into things', 'how this works', 'testimonials'],
    metadata: { stage: 'set', stageOrder: 2, followUp: 'After they confirm testimonials, move into establishing criteria and urgency.' },
  },
  {
    category: 'call_stage',
    label: 'The Set - Criteria and Urgency',
    content: 'Establish a clear criteria: "After XYZ years helping 123 people, we\'ve established a very clear criteria of who we can help and who we can\'t. The first thing we\'ve noticed with our most successful members is they have a sense of urgency - they\'ve already gone down the podcast, youtube, and self help rabbit holes only to realize they need to actually execute." Then pre-handle objections with humor: "All that we ask is to stay away from funky answers like I need to get a palm reading first or I need to speak to my goldfish about this. Given that success loves speed, delaying the first step is typically a sign that person isn\'t ready yet. Is that unreasonable?"',
    triggers: ['criteria', 'who we can help', 'sense of urgency', 'success loves speed'],
    metadata: { stage: 'set', stageOrder: 2, followUp: 'DELIVER WITH A SMILE AND HUMOR. Laughter = subconscious agreement. This pre-handles "think about it" before it happens.' },
  },

  // =========================================================================
  // CALL STAGE: DISCOVERY (most important part)
  // =========================================================================
  {
    category: 'call_stage',
    label: 'Discovery - Core Questions',
    content: 'The discovery is the MOST IMPORTANT part. Ask with genuine empathy. Core questions: "In a perfect world, what is your [industry] goal?" / "How long have you wanted to get into [industry]?" / "What\'s kept you from starting before today?" / "What\'s changed? Why is now the time?" / "What is your WHY?" / "If this ends up not being a good fit, what\'s plan B?" / "What is your biggest fear of [industry]?" / "What makes you a good fit for the team?"',
    triggers: ['perfect world', 'how long have you', 'what kept you', 'what is your why', 'plan b', 'biggest fear'],
    metadata: { stage: 'discovery', stageOrder: 3, followUp: 'Help them get clear on what they want, what they are willing to do, and that they BELIEVE it is possible. By the end they should feel an emotional wave pushing them toward commitment.' },
  },
  {
    category: 'call_stage',
    label: 'Discovery - Pain Amplification Sequence',
    content: 'Use this sequence to amplify pain: 1) "How long have you been feeling like you needed to make this kind of change?" 2) "What prevented you from taking action in the past?" 3) "You\'ve been thinking about this for [x time] so what have you LOST because of this?" 4) "So what happens if you hold onto this way of thinking? What does reality look like?" 5) "How committed are you to actually investing in yourself? Because you don\'t have to..."',
    triggers: ['how long', 'what prevented', 'what have you lost', 'hold onto'],
    metadata: { stage: 'discovery', stageOrder: 3, followUp: 'Never pitch before pain is fully excavated. The deeper the pain, the easier the close.' },
  },

  // =========================================================================
  // DISCOVERY DIALOGUE TECHNIQUES
  // =========================================================================
  {
    category: 'discovery_technique',
    label: 'V-L-F-A-R Framework',
    content: 'V-L-F-A-R = Validate, Label, Frame, Ask, Repeat. Use after EVERY prospect response. Validate: "That makes sense" / "Totally" / "I hear you". Label: Summarize back what they said to show understanding. Frame: Provide context for your next question. Ask: Your follow-up question. Repeat. This ensures conversation flows naturally, prospect feels heard, closer maintains frame control, and the sale moves forward after every exchange.',
    triggers: ['validate', 'label', 'frame'],
    metadata: { stage: 'discovery', technique: 'VLFAR', followUp: 'Use this pattern throughout the entire discovery. It prevents awkward questioning and keeps rapport.' },
  },
  {
    category: 'discovery_technique',
    label: 'Validation Statements',
    content: 'Always start your response to a prospect with a validation statement: "That makes sense" / "Totally" / "Understood" / "Awesome" / "Right" / "I hear you". This disarms the prospect, keeps rapport, and sets up your label and follow-up question.',
    triggers: [],
    metadata: { stage: 'discovery', technique: 'validation', followUp: 'Never skip the validation. Going straight to a question feels interrogative.' },
  },
  {
    category: 'discovery_technique',
    label: 'Labels - Diagnostic Statements',
    content: 'A label is a summary you say back to the prospect to show you understand. Example - Prospect: "I want to replace my W-2 income with rental properties so I can quit my job." Closer: "That makes sense, so essentially the primary objective here is to get your time back by replacing your active income with passive cashflow." Target reaction: "EXACTLY!" If they correct you, that is also valuable - you get clarity and they still feel heard.',
    triggers: [],
    metadata: { stage: 'discovery', technique: 'labels', followUp: 'An enthusiastic "EXACTLY!" means you nailed the label. Use their exact words when possible.' },
  },
  {
    category: 'discovery_technique',
    label: 'Frames - Providing Context',
    content: 'A frame provides context/borders around a question so the prospect understands WHY you are asking. Example: "Given that replacing your W-2 income is the main priority, what are you currently taking home on a monthly basis?" Without the frame, asking about income is rude. WITH the frame, it is expected because it fits the context of what THEY shared.',
    triggers: ['given that', 'based on what you said'],
    metadata: { stage: 'discovery', technique: 'frames', followUp: 'Always frame sensitive questions (income, fears, failures) using info the prospect already shared.' },
  },
  {
    category: 'discovery_technique',
    label: 'Double Commitment Questions',
    content: 'A DCQ forces the prospect to choose between two answers, either of which moves the sale forward. Examples: "Are you currently investing in [industry] or looking to get started?" / "Are you working for yourself or someone else?" / "Do you feel like you\'re more of an action taker or an overthinker?"',
    triggers: ['or looking to', 'or someone else', 'action taker or'],
    metadata: { stage: 'discovery', technique: 'double_commitment', followUp: 'Both answers give you useful info and move the sale forward. Use early in discovery.' },
  },
  {
    category: 'discovery_technique',
    label: 'Layered Questions - Going Deeper',
    content: 'Use when the prospect does not answer with enough depth or you need more buy-in. Examples: "What exactly do you mean by that?" / "Tell me more about that." / "Go on." / "Help me understand this better." / "Can you give me an example?" Use at ANY point in discovery whenever more information, pain, or commitment is needed.',
    triggers: ['what do you mean', 'tell me more', 'help me understand'],
    metadata: { stage: 'discovery', technique: 'layered', followUp: 'These are your most versatile questions. Use them to dig deeper on anything surface-level.' },
  },
  {
    category: 'discovery_technique',
    label: 'No-Oriented Questions',
    content: 'Questions designed so the prospect answers NO. No is easier to get than yes and builds buy-in. Examples: "Are you willing to settle for [current situation]?" / "Would it be impossible to...?" / "Is it a ridiculous idea that...?" / "Are you comfortable with where your future is headed if you don\'t make a change?"',
    triggers: ['are you willing to settle', 'would it be impossible', 'is it ridiculous'],
    metadata: { stage: 'discovery', technique: 'no_oriented', followUp: 'No-oriented questions lower resistance. A "no" to settling = they want more = momentum toward your offer.' },
  },
  {
    category: 'discovery_technique',
    label: 'Fear-Based Questions',
    content: 'Designed to get the prospect to ASK YOU FOR HELP. If they admit they are too scared to do it alone, they will buy into your guidance. Examples with frames: "It sounds like this is something you\'ve wanted for a long time, what do you feel has prevented you from starting?" / "What are your fears surrounding [industry] that you feel are getting in the way?" / "It seems like this is more a mindset issue than anything else. What is it that you\'re so afraid of?"',
    triggers: ['what are you afraid of', 'what has prevented', 'biggest fear', 'what scares you'],
    metadata: { stage: 'discovery', technique: 'fear_based', followUp: 'Always be in rapport before fear-based questions. Frame them with empathy, not aggression.' },
  },
  {
    category: 'discovery_technique',
    label: 'Challenge Questions',
    content: 'Help the prospect be HONEST with themselves. People make excuses and remove responsibility. Examples: "Do you mind if I challenge you on that?" / "Do you mind if I ask you a difficult question?" / "Do you really think that\'s the reason?" / "If that truly is the case, what have you already tried to overcome it?" / "Be honest with yourself, do you truly believe you\'re doing everything you can?"',
    triggers: ['challenge you', 'difficult question', 'do you really think', 'be honest'],
    metadata: { stage: 'discovery', technique: 'challenge', followUp: 'ALWAYS be in rapport before challenging. Displays authority and increases respect when done correctly.' },
  },
  {
    category: 'discovery_technique',
    label: 'Consequence Questions',
    content: 'Show the prospect where their life is headed WITHOUT change. Examples: "Have you thought about what the next few years will look like if you kept doing the same thing?" / "Are you comfortable with where your life is headed right now?" / "If you continue to push this off, what do you think is going to happen?" / "Have you thought of the potential consequences of not doing [action]?"',
    triggers: ['next few years', 'comfortable with where', 'continue to push', 'consequences'],
    metadata: { stage: 'discovery', technique: 'consequence', followUp: 'Paint the picture of inaction. Make staying the same feel more painful than change.' },
  },
  {
    category: 'discovery_technique',
    label: 'Identity Frames and Embedded Commands',
    content: 'Identity Frame: Highlight behaviors with positive/negative consequences. Example: "The most successful people we\'ve worked with all operate under the success loves speed mantra, meaning speed to execution is the number one priority. Can you tell of a time when you executed rapidly and it paid off?" Embedded Command: Tell a story the prospect should associate with. Example: "CLIENT NAME always talks about how those who wait for the right time wait forever. He tried to time the market for 3 years and all it did was take away 3 years of progress. Does that resonate?"',
    triggers: ['most successful people', 'success loves speed', 'does that resonate'],
    metadata: { stage: 'discovery', technique: 'identity', followUp: 'Identity frames make the prospect want to be the successful type. Embedded commands plant the seed through story.' },
  },

  // =========================================================================
  // CALL STAGE: TRANSITION
  // =========================================================================
  {
    category: 'call_stage',
    label: 'Transition - Bridge to Pitch',
    content: 'The transition occurs between discovery and pitch. Green lights to transition: They\'ve defined their perfect world, uncovered their WHY, admitted what holds them back, confirmed solving this matters NOW, agreed they want help. Use: "I\'ve heard enough" / "From what we\'ve discussed, it sounds like [reasons], and MOST importantly [RESTATE THEIR WHY]" / "If you\'ve got a pen and paper, I\'m going to walk you through how we\'re going to get you to [their goal]."',
    triggers: ['i have heard enough', 'from what we discussed', 'let me walk you through', 'pen and paper ready'],
    metadata: { stage: 'transition', stageOrder: 4, followUp: 'Only transition when you have all 5 green lights. If prospect sees the gap, show them the bridge.' },
  },

  // =========================================================================
  // CALL STAGE: PITCH / OFFER PRESENTATION
  // =========================================================================
  {
    category: 'call_stage',
    label: 'Pitch - Three Pillar Structure',
    content: 'Present the offer through 3 pillars: 1) Training/Education - "Like a GPS guiding you one instruction at a time with specific action items to implement right away." 2) Hands-on Coaching - "Education is important, but if I wanted to learn how to swim, I\'ll never be successful until I get in the water. That\'s why this is my favorite part. Open line of communication, live coaching calls, you\'ll never make a decision alone." 3) Network - "This is where CLIENT will save you years by referring to their connections upon request."',
    triggers: ['three pillars', 'training', 'coaching', 'network', 'how the program works'],
    metadata: { stage: 'pitch', stageOrder: 5, followUp: 'Present with their goal as the intro. Use no-oriented check-ins throughout: "Is anything unclear?" / "Am I going too fast?"' },
  },
  {
    category: 'call_stage',
    label: 'Pitch - No-Oriented Check-ins',
    content: 'Throughout the pitch, use no-oriented check-ins to keep the prospect engaged and catch confusion early: "Is anything unclear?" / "Am I going too fast?" / "Anything you don\'t understand until now?" These questions keep the prospect in active listening mode and prevent objections later.',
    triggers: ['is anything unclear', 'am i going too fast', 'anything you dont understand'],
    metadata: { stage: 'pitch', stageOrder: 5, followUp: 'If they say something IS unclear, address it immediately. Never bulldoze past confusion.' },
  },

  // =========================================================================
  // CALL STAGE: THE CLOSE
  // =========================================================================
  {
    category: 'call_stage',
    label: 'Close - Summarizing Statement',
    content: 'Recap the offer: "Just to recap everything, we\'ll start with the foundation, give you the roadmap so you know exactly what to do now and what to do next. We\'ll be there in our direct communication as well as our weekly calls to review your questions, give you direction, and make sure you\'re supported every step of the way, and with access to CLIENT\'s entire network, that\'s how we\'ve been able to help XYZ people over these last few years."',
    triggers: ['just to recap', 'recap everything', 'summarize'],
    metadata: { stage: 'close', stageOrder: 6, followUp: 'Keep it concise. Hit the 3 pillars one more time tied to THEIR goals.' },
  },
  {
    category: 'call_stage',
    label: 'Close - No-Oriented Question + Temp Check',
    content: 'After summarizing, ask: "Now that you know EVERYTHING about the program, is there anything you feel is missing or you were hoping I would say that would help you?" Then temp-check: "Are you nervous, excited, or maybe a little bit of both?" This surfaces any hidden objections before presenting price.',
    triggers: ['anything missing', 'were hoping', 'nervous or excited', 'how are you feeling'],
    metadata: { stage: 'close', stageOrder: 6, followUp: 'If they say something is missing, address it now. The temp check tells you their emotional state before the investment anchor.' },
  },
  {
    category: 'call_stage',
    label: 'Close - Investment Anchor',
    content: 'The closer brings up price confidently. Make them feel empowered, incentivize today, provide next steps. Example: "Unlike most programs, this is just a one time investment. We\'re not going to call you in 6 months and push you into a deluxe package. Also, this is education, which means it\'s tax deductible. Normally the program is [X+2k], and that covers EVERYTHING for life. Since [incentive reason], we take 2k away making it just [X]." Then SILENCE. Or: "Where would you like to go from here?"',
    triggers: ['the investment is', 'the price is', 'the cost is', 'how much', 'where would you like to go'],
    metadata: { stage: 'close', stageOrder: 6, followUp: 'SILENCE after stating the price. Let them process. Do not fill the silence. The first person to talk after the price loses.' },
  },

  // =========================================================================
  // IDENTITY SHIFTING METHODOLOGY (meta-framework)
  // =========================================================================
  {
    category: 'methodology',
    label: 'Identity Shifting - The 5 Phases',
    content: 'Every objection follows this psychological architecture: Phase 1: ISOLATE THE LOGIC - "Setting aside [objection], would you do it?" If yes, the objection is emotional not logical. Phase 2: CREATE BINARY IDENTITY FRAMES - Present two types of people, one who gets results and one who does not. They must choose. Phase 3: EXCAVATE HISTORICAL PATTERNS - Use their own past to prove your point. Their life is the evidence. Phase 4: MIRROR CURRENT REALITY - Connect their objection to why they are on the call. Their thinking NOW is the same thinking that created their current situation. Phase 5: FORCE THE IDENTITY CHOICE - "Which version of yourself is making this decision?" Let them sit in silence.',
    triggers: ['identity shifting', 'five phases', 'psychological'],
    metadata: { framework: 'identity_shifting', followUp: 'Never argue. Their past is your proof. Connect objection to problem. Create cognitive dissonance. Silence is your friend.' },
  },
  {
    category: 'methodology',
    label: 'Execution Principles - 6 Rules',
    content: '1) NEVER ARGUE - Question the objection, let them discover it does not hold up. 2) THEIR PAST IS YOUR PROOF - You do not need testimonials. Their own life is the evidence. 3) CONNECT OBJECTION TO PROBLEM - The way they think about THIS decision is why they are in their current situation. 4) CREATE COGNITIVE DISSONANCE - Make their objection incompatible with their goals. Tension creates movement. 5) FORCE THE IDENTITY CHOICE - Every track ends with "Which person are you going to be?" 6) SILENCE IS YOUR FRIEND - After a powerful question, stop talking. The breakthrough happens in the silence.',
    triggers: ['never argue', 'silence', 'cognitive dissonance', 'identity choice'],
    metadata: { framework: 'execution_principles', followUp: 'Review these before every call until second nature.' },
  },

  // =========================================================================
  // CLOSING TACTICS (carried over)
  // =========================================================================
  {
    category: 'closing_tactic',
    label: 'Assumptive close',
    content: 'Skip "do you want to do this." Say: "Let me get you set up - do you prefer the full pay or the payment plan?"',
    triggers: [],
    metadata: { stage: 'close', followUp: 'Use after 2+ buying signals. Ask which, not if.' },
  },
  {
    category: 'closing_tactic',
    label: 'Cost of inaction close',
    content: 'Make doing nothing tangible: "You told me this costs you [X] per month. If we solve it in 90 days, that is [3X] saved. If you wait 6 more months, that is [6X] gone."',
    triggers: [],
    metadata: { stage: 'close', followUp: 'Use their own numbers. Make waiting more expensive than investing.' },
  },
  {
    category: 'closing_tactic',
    label: 'Permission close',
    content: 'Soft close: "Based on everything you\'ve shared, it sounds like this is exactly what you\'ve been looking for. Am I wrong about that?"',
    triggers: [],
    metadata: { stage: 'close', followUp: 'Gets them to confirm their own interest.' },
  },
];

async function seed() {
  console.log('Seeding knowledge base with ' + entries.length + ' framework entries...');
  console.log('');

  var succeeded = 0;
  var failed = 0;

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
      console.error('  FAILED: ' + e.label + ' - ' + result.error.message);
      failed++;
    } else {
      console.log('  [' + e.category + '] ' + e.label);
      succeeded++;
    }
  }

  console.log('');
  console.log('Done! ' + succeeded + ' entries seeded, ' + failed + ' failed.');
}

seed();
