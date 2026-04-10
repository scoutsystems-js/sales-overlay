// Complete objection handling frameworks
// Each objection has phases that build on each other sequentially.
// Local detection catches the objection type instantly.
// Claude + KB determine which phase to suggest based on conversation context.

var OBJECTIONS = [
  {
    id: 'money',
    triggers: [
      'cannot afford', "can't afford", 'too expensive', 'too much money',
      'out of my budget', 'not in my budget', 'money is tight',
      'i dont have the money', "i don't have the money",
      'more than i expected', 'more than i was expecting',
      'i cant do that price', "can't swing that", 'way too much',
      'not worth that much', "that's steep", 'thats steep',
    ],
    label: 'Money Objection',
    framework: 'money',
    phaseCount: 8,
    rebuttal: 'Money aside, would you do it?',
    followUp: 'Wait for YES, then ask "Why would you though?" — let them sell themselves. Then isolate: "Is it a logistical thing where this is going to make you completely broke? Or is it something else?"',
  },
  {
    id: 'talk-to-spouse',
    triggers: [
      'talk to my wife', 'talk to my husband', 'talk to my spouse',
      'talk to my partner', 'check with my partner', 'ask my wife',
      'ask my husband', 'run it by my wife', 'run it by my husband',
      'wife would kill me', 'husband would kill me', 'partner first',
      'significant other', 'better half',
      'gotta talk to my', 'got to talk to my', 'need to talk to my',
      'check with my wife', 'check with my husband',
    ],
    label: 'Talk to My Wife',
    framework: 'spouse',
    phaseCount: 8,
    rebuttal: 'How do you know that respecting your wife means you can\'t make a change today to make more money for your family?',
    followUp: 'Challenge the premise immediately. Then move into the Captain\'s Ship parable to reframe leadership vs. permission-seeking.',
  },
  {
    id: 'think-about-it',
    triggers: [
      'think about it', 'let me think', 'need to think', 'need some time',
      'sleep on it', 'sit with it', 'mull it over', 'consider it',
      'think it over', 'give me a day', 'give me a few days',
      'not ready to decide', 'big decision', 'pray about it',
      'need clarity', 'meditate on it',
    ],
    label: 'I Need to Think About It',
    framework: 'think',
    phaseCount: 10,
    rebuttal: 'How do you know that thinking about it longer will lead you to making a better decision?',
    followUp: 'Wait for their logic, then ask "Has that been true in your experience?" — force them to confront their own pattern of overthinking.',
  },
  {
    id: 'no-time',
    triggers: [
      "don't have time", 'dont have time', 'too busy', 'not enough time',
      "i'm swamped", 'im swamped', 'schedule is packed', 'no bandwidth',
      'plate is full', 'overwhelmed', 'stretched thin', 'crazy schedule',
      'time is the issue', 'when would i even',
    ],
    label: 'No Time',
    framework: 'time',
    phaseCount: 6,
    rebuttal: 'When you say you don\'t have time, what are you really saying? Are you saying you don\'t have time, or that this isn\'t a priority?',
    followUp: 'Challenge priority vs. time. Then dig into what they ARE spending time on that isn\'t moving the needle.',
  },
  // --- Secondary objections (no full framework yet, single-phase) ---
  {
    id: 'tried-before',
    triggers: ['tried programs before', "didn't work before", 'wasted money', 'been burned', 'bad experience', 'last coach', 'previous program'],
    label: 'Tried Programs Before',
    framework: null,
    phaseCount: 1,
    rebuttal: 'I appreciate you being upfront about that. Most people who invest at this level have tried things that did not pan out. What do you think was missing from those experiences that kept them from working?',
    followUp: 'Let them tell you what failed so you can position your offer as the fix for exactly that.',
  },
  {
    id: 'send-info',
    triggers: ['send me information', 'send me more info', 'send over details', 'can you email me'],
    label: 'Send Me Information',
    framework: null,
    phaseCount: 1,
    rebuttal: 'Happy to. But honestly, most of the important stuff is what we are covering right now. What specific question do you have that, if I answered it here, would help you make a decision today?',
    followUp: 'This is almost always a polite exit. Pull them back into the conversation.',
  },
  {
    id: 'guarantee',
    triggers: ['guarantee', "what if it doesn't work", 'refund policy', 'money back'],
    label: 'What is the Guarantee',
    framework: null,
    phaseCount: 1,
    rebuttal: 'Great question. We guarantee the process, the support, and the framework. What we cannot guarantee is effort. But you do not strike me as someone who has a problem with that.',
    followUp: 'Acknowledge the concern, reframe around their commitment.',
  },
  {
    id: 'more-research',
    triggers: ['do more research', 'look around', 'compare options', 'shop around'],
    label: 'Need to Do More Research',
    framework: null,
    phaseCount: 1,
    rebuttal: 'Makes sense. What would you be comparing us against, specifically? I want to make sure you are looking at the right things so you do not waste time.',
    followUp: 'Find out who or what the competition is. Then position against it directly.',
  },
  {
    id: 'not-right-time',
    triggers: ['not the right time', 'bad timing', 'maybe later', 'in a few months', 'after the holidays', 'next quarter', 'start next month'],
    label: 'Not the Right Time',
    framework: null,
    phaseCount: 1,
    rebuttal: 'What would have to change in the next few months for this to become the right time?',
    followUp: 'Surface the real blocker. Timing is rarely the actual issue.',
  },
  {
    id: 'proof-it-works',
    triggers: ['will it work for me', 'how do i know', 'does it work', 'proof it works', 'success rate'],
    label: 'How Do I Know It Will Work',
    framework: null,
    phaseCount: 1,
    rebuttal: 'The people who get results have one thing in common: they show up and do the work. Based on what you have told me today, do you see yourself as someone who would actually follow through?',
    followUp: 'Turn the question back on them. Make them self-identify as someone who executes.',
  },
];

// Common words that should NOT count toward fuzzy objection matching
// These appear in normal conversation all the time
var OBJECTION_STOP_WORDS = [
  'the', 'that', 'this', 'what', 'when', 'where', 'which', 'who', 'how',
  'you', 'your', 'they', 'them', 'their', 'its', 'our', 'our',
  'are', 'was', 'were', 'been', 'have', 'has', 'had', 'does', 'did',
  'will', 'would', 'could', 'should', 'can', 'may', 'need',
  'for', 'and', 'but', 'not', 'with', 'from', 'about', 'just',
  'some', 'any', 'all', 'more', 'know', 'like', 'get', 'got',
  'going', 'want', 'let', 'make', 'time', 'work', 'out',
];

// Simple Levenshtein distance for short strings
function simpleEditDistance(a, b) {
  if (a.length > 10 || b.length > 10) return 99;
  var matrix = [];
  for (var i = 0; i <= a.length; i++) { matrix[i] = [i]; }
  for (var j = 0; j <= b.length; j++) { matrix[0][j] = j; }
  for (var i = 1; i <= a.length; i++) {
    for (var j = 1; j <= b.length; j++) {
      var cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }
  return matrix[a.length][b.length];
}

// Strict fuzzy match — only for triggers with distinctive words, and only
// checks edit distance on 5+ character words (to catch wife→wipe, husband→husbnd)
// Requires ALL distinctive words to match (not a percentage)
function fuzzyTriggerMatch(transcript, trigger) {
  // Only apply fuzzy matching to triggers with at least 4 words
  var allTriggerWords = trigger.split(/\s+/);
  if (allTriggerWords.length < 4) return false;

  // Extract distinctive words (5+ chars, not stop words)
  var distinctiveWords = allTriggerWords.filter(function(w) {
    return w.length >= 5 && OBJECTION_STOP_WORDS.indexOf(w) === -1;
  });

  // Need at least 2 distinctive words to even attempt fuzzy matching
  if (distinctiveWords.length < 2) return false;

  var transWords = transcript.split(/\s+/);
  var matchCount = 0;

  for (var i = 0; i < distinctiveWords.length; i++) {
    var tw = distinctiveWords[i];
    var found = false;
    for (var j = 0; j < transWords.length; j++) {
      // Exact word match
      if (transWords[j] === tw) { found = true; break; }
      // Starts-with match (talking→talk)
      if (transWords[j].length >= 4 && (transWords[j].indexOf(tw) === 0 || tw.indexOf(transWords[j]) === 0)) {
        found = true; break;
      }
      // Edit distance ≤ 1 for words 5+ chars (wife→wipe, afford→aford)
      if (tw.length >= 5 && transWords[j].length >= 4) {
        if (simpleEditDistance(transWords[j], tw) <= 1) { found = true; break; }
      }
    }
    if (found) matchCount++;
  }

  // ALL distinctive words must match (strict — prevents false positives)
  return matchCount === distinctiveWords.length;
}

function detectObjection(transcript) {
  var lower = transcript.toLowerCase();
  for (var i = 0; i < OBJECTIONS.length; i++) {
    var objection = OBJECTIONS[i];
    for (var j = 0; j < objection.triggers.length; j++) {
      // First try exact substring match (fast path)
      if (lower.indexOf(objection.triggers[j]) !== -1) {
        return objection;
      }
    }
    // Then try fuzzy match against ALL triggers for this objection
    // (only activates for triggers with 4+ words and 2+ distinctive words)
    for (var j = 0; j < objection.triggers.length; j++) {
      if (fuzzyTriggerMatch(lower, objection.triggers[j])) {
        console.log('[objections] Fuzzy match: "' + objection.triggers[j] + '" in "' + lower.substring(0, 60) + '..."');
        return objection;
      }
    }
  }
  return null;
}

module.exports = { OBJECTIONS: OBJECTIONS, detectObjection: detectObjection };
