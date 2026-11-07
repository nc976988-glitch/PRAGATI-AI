'use strict';
// Built-in concept pack: honest offline answers for common engineering-student topics.
// (Each entry = keywords, a plain-English explanation, a Hindi gist, and an example.)
const K = [
  { k: ['binary search'], t: 'Binary Search', en: 'Binary search finds an item in a SORTED array by repeatedly halving the search range: compare the middle element with the target, then discard the half that cannot contain it.', hi: 'Sorted array me beech wale element se compare karke har baar aadha hissa hata dete hain.', ex: 'Find 23 in [2,5,8,12,16,23,38]: mid=12 → go right → mid=23 ✔', cx: 'Time O(log n), Space O(1)' },
  { k: ['recursion'], t: 'Recursion', en: 'A function that solves a problem by calling itself on a smaller version of the same problem, until it reaches a base case that stops the calls.', hi: 'Function khud ko chhote problem par call karta hai jab tak base case na aa jaye.', ex: 'factorial(n) = n × factorial(n−1), base: factorial(0)=1', cx: 'Watch the call-stack depth: O(depth) space' },
  { k: ['deadlock'], t: 'Deadlock (OS)', en: 'A situation where a set of processes wait forever because each holds a resource another one needs. It needs 4 conditions together: mutual exclusion, hold & wait, no pre-emption, circular wait.', hi: 'Sab processes ek-dusre ke resource ka wait karte rehte hain — koi aage nahi badhta.', ex: 'P1 holds R1 wants R2; P2 holds R2 wants R1.', cx: 'Break any one of the 4 conditions to prevent it.' },
  { k: ['normalization', 'normalisation', '1nf', '2nf', '3nf', 'bcnf'], t: 'Database Normalization', en: 'Organising tables to reduce redundancy and update anomalies. 1NF: atomic values. 2NF: no partial dependency on a composite key. 3NF: no transitive dependency. BCNF: every determinant is a candidate key.', hi: 'Table ko aise todna ki data repeat na ho aur update/delete me galti na ho.', ex: 'Split Student(id, name, dept, dept_head) → Student + Department.', cx: 'Trade-off: fewer anomalies vs more joins.' },
  { k: ['tcp', 'udp', 'tcp vs udp'], t: 'TCP vs UDP', en: 'TCP is connection-oriented, reliable and ordered (handshake, ACKs, retransmission). UDP is connectionless and fast but gives no delivery guarantee.', hi: 'TCP bharosemand par dheema; UDP tez par guarantee nahi.', ex: 'TCP: web, email. UDP: video calls, games, DNS.', cx: '' },
  { k: ['ohm', "ohm's law", 'ohms law'], t: "Ohm's Law", en: 'The current through a conductor is proportional to the voltage across it: V = I × R, at constant temperature.', hi: 'Voltage = Current × Resistance.', ex: '12 V across 4 Ω → I = 3 A', cx: 'P = V·I = I²R' },
  { k: ['thermodynamics first law', 'first law of thermodynamics'], t: 'First Law of Thermodynamics', en: 'Energy is conserved: the change in internal energy of a system equals heat added minus work done by the system, ΔU = Q − W.', hi: 'Energy na banti hai na khatam hoti hai — sirf roop badalti hai.', ex: 'Gas absorbs 500 J heat and does 200 J work → ΔU = 300 J', cx: '' },
  { k: ['entropy'], t: 'Entropy', en: 'A measure of disorder (or the number of microscopic arrangements) of a system. For an isolated system, entropy never decreases (Second Law).', hi: 'System ki ashanti/disorder ka maap; isolated system me kabhi ghat-ti nahi.', ex: 'Ice melting increases entropy.', cx: 'ΔS = Q_rev / T' },
  { k: ['stack', 'queue', 'stack vs queue'], t: 'Stack vs Queue', en: 'Stack is LIFO (last in, first out) — push/pop at one end. Queue is FIFO (first in, first out) — enqueue at the rear, dequeue at the front.', hi: 'Stack: jo last me aaya wahi pehle nikle. Queue: jo pehle aaya wahi pehle nikle.', ex: 'Stack: undo, call stack. Queue: print jobs, BFS.', cx: 'All core ops O(1)' },
  { k: ['big o', 'big-o', 'time complexity', 'asymptotic'], t: 'Big-O Notation', en: 'Describes how running time or space grows as input size n grows, ignoring constants: O(1) < O(log n) < O(n) < O(n log n) < O(n²) < O(2ⁿ).', hi: 'Input bada hone par algorithm kitna slow hoga — uska upper bound.', ex: 'Loop inside loop over n → O(n²)', cx: '' },
  { k: ['pointer', 'pointers'], t: 'Pointers (C/C++)', en: 'A pointer is a variable that stores the memory address of another variable. `int *p = &x;` makes p hold the address of x; `*p` reads/writes x.', hi: 'Pointer ek variable hai jo kisi dusre variable ka address rakhta hai.', ex: 'int x=5; int *p=&x; *p=9; → x becomes 9', cx: '' },
  { k: ['oop', 'object oriented', 'object-oriented', 'oops'], t: 'Object-Oriented Programming', en: 'Organising code around objects that bundle data and behaviour. Four pillars: encapsulation, abstraction, inheritance, polymorphism.', hi: 'Code ko objects me baantna — data aur function saath me.', ex: 'class Car extends Vehicle { … }', cx: '' },
  { k: ['machine learning', 'ml'], t: 'Machine Learning', en: 'Algorithms that learn patterns from data to make predictions or decisions, instead of being explicitly programmed. Main types: supervised, unsupervised, reinforcement learning.', hi: 'Data se seekhkar prediction karna, rules likhe bina.', ex: 'Spam filter trained on labelled emails.', cx: '' },
  { k: ['photosynthesis'], t: 'Photosynthesis', en: 'Plants convert light energy, CO₂ and water into glucose and oxygen: 6CO₂ + 6H₂O + light → C₆H₁₂O₆ + 6O₂. Light reactions occur in thylakoids; the Calvin cycle in the stroma.', hi: 'Paudhe sunlight se khana (glucose) banate hain aur oxygen chhodte hain.', ex: '', cx: '' },
  { k: ['newton', "newton's laws", 'laws of motion'], t: "Newton's Laws of Motion", en: '1) A body stays at rest or in uniform motion unless a net force acts. 2) F = m·a. 3) Every action has an equal and opposite reaction.', hi: 'Inertia, F=ma, aur action-reaction.', ex: 'A 2 kg block pushed with 10 N accelerates at 5 m/s².', cx: '' },
  { k: ['sorting', 'quick sort', 'quicksort', 'merge sort', 'mergesort'], t: 'Sorting: Quick vs Merge', en: 'Merge sort splits, sorts and merges: always O(n log n), stable, needs O(n) extra space. Quick sort partitions around a pivot: O(n log n) average, O(n²) worst case, in-place.', hi: 'Merge sort hamesha n log n; quick sort average me tez par worst case n².', ex: '', cx: '' },
];

function lookup(q) {
  const s = q.toLowerCase();
  let best = null, score = 0;
  for (const e of K) for (const key of e.k) {
    if (new RegExp('(^|[^a-z0-9])' + key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '([^a-z0-9]|$)', 'i').test(s)) {
      const sc = key.length; if (sc > score) { score = sc; best = e; }
    }
  }
  return best;
}
module.exports = { lookup, topics: K.map((e) => e.t) };
