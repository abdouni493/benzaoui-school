You are a senior full-stack engineer working directly inside my codebase 
in VS Code via Claude Code. You can read, search, and edit the project 
files yourself.

Your job: analyze my application and fix the request I describe at the 
bottom — cleanly, safely, and completely.

Follow this process:

1. EXPLORE FIRST — Before changing anything, examine the relevant parts of 
   the project: structure, framework, database layer, and the files tied to 
   my request. Detect the tech stack and the SQL dialect (MySQL, PostgreSQL, 
   etc.) from the project itself.

2. PLAN — Briefly tell me what you understand the problem to be, the root 
   cause, and your proposed fix (which files you'll change and why). Keep it 
   short.

3. IMPLEMENT — Apply the fix directly to the files. Match the existing code 
   style and conventions. Do not break existing functionality.

4. TRACK DATABASE CHANGES — As you work, record every database change your 
   fix requires: new tables, new/altered columns, indexes, constraints, 
   foreign keys, seed data, etc.

Rules:
- Be specific and name the exact files and functions you change.
- Flag anything risky (security, data loss, performance) BEFORE doing it.
- Verify against the real schema/models — never invent columns or fields 
  that don't exist.
- If something is ambiguous or destructive, ask me before proceeding.

VERY IMPORTANT — At the very END of your response, give me ONE consolidated, 
ready-to-run SQL script with ALL database changes needed for this update:
- Use the correct SQL dialect for this project.
- Put it in a single ```sql code block.
- Order the statements so they run top-to-bottom without errors.
- Make it safe to re-run (use IF NOT EXISTS / IF EXISTS where appropriate).
- Add a short comment above each statement explaining what it does.
- If no database changes are needed, say clearly: "No SQL changes required."

Here is my request:

fix the prinitng of invoice when user create new sold make it display on the bon also the email and password of the account of that student and make sure to make the invoice display also the modules that student subscribe on them 

fix the interface of assign subscription mobule create on it new option make it for reduction let user can set reduction for each module with pourcentage or with montan fix and make sure to make when user presenting make sure to make it calculate the decreasing with that reduced price for each module and for the reduction option make another option of selecting multipes modules and make on them the reduction on the one time without set each one independently

fix the interface of emploi du temps make new option let user can select create timing for seaces libre then let him select the classes that about metter of this seach libre and make possibility of select multiple classes and multiple groupes andm ultiple sales and make new option let user can set the starting date and ending date of this seance libre and according to that selected periode make sure to make user can select the days of that periode that will students study this seances libre then let him set the hout and minutes of starting and ending and make the name of timing save with another format more claire for the seaces libre and make option of user set the price of one seance of this seances libre and make sure to make when user create the timing then make it save that subscription on the interface of subscription automatically with informations of that seance libre and information of the module and informaitons acount the price and make it display normally on the interface of subscription like its user create it on the interface of subscription
and for the selecting of teachers make new option of user can seach about existing teacher with make sure to make the teacher pay about this seance libre like the other seances and make new option user can type only the teacher name as teacher passager then make sure to make when user create the emploi du temps of this seance libre make that teacher save on the interface of teachers with payment button action and view details button action only make the interface of button action of view details display the history of seances libre of this teacher and make it display on another part the number of students that study on his seances libre and make sure to make this interface of view details display more informations about this teacher with all the small details also of payements 
make the button action interface of payment display the total students that presented on his seance libre timing and make user can type amount of how much will pay to this teacher and make another payment methode with poucentage let user set the pourcentage that will get for each student and for each module cost and make it calculate how much he have to pay for him automatically and make button for display the details of the students that presented for that timing and filter them by group for each one and make it display also how much student passager 
when user create the payment make option of user can print it with make the template organized and display this details : 
school informations and logo and make it display the informstions of the teacher and the informations of that timing and make it display the toatl of students that presented of that timing and make it display how much the teacher will get money 
make sure to make the interface of payment display only the not payed timings of that teacher when user create the payement make sure to makethat timing with payed statue and do not display it again on the interface of payment 
this treatement for the teacher passager that not have accounts on the school 
and for the other teachers that created on the system make them payed on the seance libre normally like the same treatement of the payement of the normal courses
make sure to fix the interfac of create new seance libre for the students passager make it user can search about a cours or can search about a seance libre created on the timing interface and remove the creaion of perfectionement make sure to fix the interface of seance libre and perfectionement make it only for the creation of the seaces libre make sure to make on it only one interface and one button for create the seances libre make it sure to make it user can search about existing student with his name or with carnumber and make if the user did not seach about the student and did not select any student then make it save that student on the creation of seance libre as passager and make sure to make the interface of create seance libre only like this : let the user can search about the normal cource module and mkae sure to make it display all informations about that cours for make more clair and make it can search about seance libre timing and let him select it to load the price and make sure can create and make the main page display all the seances libre and students name or with name of passager and make on the cards button action of edit and delete and view details to see the informatons of that created seance libre and make options for the filtering and option for the seaching and make the cards displaying the date and hours and minuts of the creation and make option of user can seach and filtering and can switch the view to table 

fix the pronounicing of the alerts when user scan his card i removed the cases and only set 5 alerts make them like this : 
1.debt.mp3 if the user have debt 
2.credit_insufficient.mp3 if the student dont have credit to enter
3.welcome.mp3 for the entering normally 
4.already_scanned.mp3 for the scaning multiple times 
5.card_not_found.mp3 if the card not found

make sure to fix the scanning system make on it new condition if the student is from friday to the next friday have not scanned his car on some module them make sure to make that price of that module minus from his sold automatically and make sure to program this option for each module independently and make sure to make this information display on the history of that student and make it display on the acount of that student and on the account of that parent 

fix the template of print the payment invoice of teachers remove the details make only like this : make it display the informaitons of the school and logo and informations of the teacher and make it display only the total number of students that presented for each group and make it display table and organized this informations of the payment and make it calculate the total with pourcentage of that teacher for each groupe and on the final make it display the total ammount to pay

fix the interface of anonces make new option user can seach about the groupes that will see the anonce with possibillity of multiple selecting groups that will see the anonce and make the parents of each student can see that anonce also and make option for select all or select the teachers only and make sure to make on it all the options of filtering 

fix the interface of reports create new par interface on the interface of repports make it for the generale reports analyses make it display on that seelcted period a pourcentage circle for see the the total binifits pourcnetage and total payements of teachers pourcentage and make a pert on the circle make it for the total of expenses and make part for the payements of the other workers and make sure to make this informations display out the circle also more detailed and make sure to make to do another part for the analyse by teacher how much the pourcnetage of each teacher how much he participating for the total gains and make filtering to see the part of that teacher for the payment pourcentage on that periode 

fix the interface of workers make new option on the creation of the workers make it for user can scan an rfid card for that worker and make sure to make new methode for payement with hours and price for one hour 
make this option on the payement like this :
let the user for each day pointing the preseneting and the ending of his work and make it calculate for each day how much hours he worked and make sure to fix the interfae of payment for this workers type make it display only the not payed days for that worker and make it dispay the tatal hourse of that not payed days and make button for see the details of all that calculated days make it dipslay for each day how much hours he worked and let the user can save the payement and do not display that payed days again 
for the scanning of the worker make condition if the worker pointing the work starting and did not pointing the ending of the work then stop the calculating of the hours of that day when its ending that day and make sure to make that day freesing and make sure to make it display an alert on his car and user can click on the view details interface for fix the problem and set the ending hour of that worker and make sure to make it display alert on the payement interface also if there is days like this user did not set the poinitng of ending work make it display alert and make user can click on it to see the problem and can edit it and fix it with set the ending hour of that day 