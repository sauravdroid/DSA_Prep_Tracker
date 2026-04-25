Can you help create a simple react app, which queries leetcode, it's main goal is to track my DSA prep progress.
It should have a calendar view, where when I click on a particular date, it should show the list of new problems solved and the list of revision problems.

Also in the main page I should have a list of previously solved problems grouped by topic and I can select to revise them, once I click on the problem, it should give me the leetcode link, the topic and the last solved date. I can mark it as revised and that will add it in the revised list for the date.

I should also have a feature where it create a list of 5 problems that I can revise that day, which I haven't revised based on the topics. The main idea will be to not lose touch of the previously solved topics

To fetch the code that I have solved it should fetch the problems from leetcode.

// Feature enhancement.
There should be a button where I should have 3 options. Which mentions the ease of recall.
1. Easy 2. Sturggled but was able to come up with solution 3. Had to look at solution.
the 3rd one being the lowest rating
And able to add notes.

2. Score patterns that I feel I haven't understood properly and I should be able add problems specifically and add notes

3. Add feature to add problems to solve for tomorrow, you will need to create a new tab for that. And there needs to marker in the calendar cell, if we achieved the goal. Maybe a check mark which hits the dopamine level correctly

4. When navigating to the next day in the detailed view of right pane in the Calendar tab, future tabs shouldn't be navigable
5. Fix the pop-up UX it's opacity should be the highest and we shouldn't see the next cell details of a neighbour's cell, when we hover on another neighbour cell