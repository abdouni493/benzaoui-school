remove the quick access button on the login page and create on the login page button for create admin account with name and username and email and password and make sure to make the button of create new admin account hide when user create the admin account correctly 

analyse the application a deep analyse and give me the full sql code for this application make sure to remove all the constant data  to connect it with this supabase data base connection :
project url : https://jehpfbupmhbnbbkzhiwr.supabase.co

anon key : eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImplaHBmYnVwbWhibmJia3poaXdyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODcwNzk5NzIsImV4cCI6MjEwMjY1NTk3Mn0.WkEp9gUnjPiztMPha5xUmvkP5lD17mt9eBXk9RrwBqI

make sure to make on the sql code all the table for all the interfaces and all the relations between the interfaces and make sure to make them contains all the button actions and make on the sql code the creation of the admin account from the login page and the creation of workers account and the creation of teachers account will create on the supabase authentification table and make sure to let all of them login to his session disrectly without problems 

make sure to connect all the interfaces and all the button action to make them use only the supabase data base connection 


fix the interface of presence make it option of user can set the time of starting presenting to make the presenting automatique or user can click on starting presence manually 


frais dinscription type 1 for 3eme lyce automatique on the creation 
fix the interface of create new student make it the first thing that will have to select the user after the remplireation of informaitons perssonal is the selecting of classe and year if user select 3eme lycee then make sure to make it select for frais dinscripiton the type 1 automatically 




condition if user choose a classe on the firts creation then make sure to make all the inscriptions on that classe and year and that filere if user tried to inscribe the studnet on anothe class or another year or another filier then dispay for him alert and do not let him created him on a filer and year and classe diffrent than that first creation

fix the interface of students make it user can seach about student from rfid on the text box of searching 

make sure to fix the scanning make it when student scan correclty then its will decrease from his sold and the teacher will get payed from that seance then make sure to fix the interface of view details button action interface on the interface of students make on the part of presences user can remove that presence and recover that decreased sold 






fix the interface of teacher payment make it display all the emplois du temps and groups of that teacher and make option of user can select the emploi du temps and create the payment of that teahcer for taht emploi du temps and for that not payed seances for that emploi du temps and make sure to keep the not selected emploi du temps of this payment let them keep not payed 
and let the user can print it and make sure to make it display on the history of payments of that teacher and let the user can print it 

fix the interface of create new student add for it alert when user type name and familly name is exactly like some student have the same name and familly name and let the user click on it on the alert for see all the details of that student on the same interface make sure to make it display all the emploi du temps and presences and payments and debts and all the small details and let the user can create the student with the same familly name and name 

fix the interface of create new emploi du temps make sure to make it optional let user can activate it or not activate it for let the user set the first seance offetiellement that from it will starting calculating the the presernces and abseneces and decreasing from his sold 

fix the workers interfce make sure to make it on the creation of the worker let the user can add for it rfid and make sure to make it when user scan his card its will start his working and when user scan it again then its will pointing ending of working and make option on the workers interface make it for set the presenses and the starting of the working of that working manually and and make it can end his work manually also then make sure to make it display on the interface of view details of that worker display all the presensses and all the scaning and all the presenses anda basenses and make sure to make option on the workers traitement if the worker did not scan his card as presesnce and the user did not made his presence manuallly then make sure to make it absent automatically and save this information and display it on the interface of view details of that worker and on the interface of payment and fix the creation of workers of payement with month let the user set the starting date of working for that workers then  make sure to fix the interace of payment of worker make it better design and large will display all the details and make it display all the days not payed and the month not payed for that workers according to the payment methode and make sure to make it display the pointing starting for each day let button for user can see all this details then make it calculate the payment correctly with possibiity of user can edit the payment manually and can print it form the view details interface and make sure to add more options on this interface proffetion that will help for manage the worker correctly
then make sure to make it display on the interface of workers and on the dashboard display alert for the payment soon for the workers of monthly and make it display alerts with animations for the workers payment if retard

fix the interface of caisse make sure to make it display on special part make it dsiplay how much each worker how much he encaisser money from his account make button for see the history of transactions of money for each account with let user can set the starting date and ending date for each account for see the total and for see the transactions of paymenet from the students that worker and that account made so make sure to make the creation of student charging sold get the informaitons of account that made this transaction

create new interface on the side bare name it particulier let it like this : 
let the user can create new seance particulet with set this informaitons : 
let user search and select student if the student existing on the data base 
and make possibility of user can create new student on the same interface with make it display the same interface of create new student on the interface of students and let him create the student and select it automatically 
and make possibility of user can do not search and select the student and can do not create new student 
let him just set this infromatons of the student : 
full name 
phone number 
seconde phone number optional 
then let him select the classe and year and filiere of that student
and let user set date and hour of this seance
then let user select the module with possibility of create new module on the same interfaces and let the user can select multiple modules on the same seance particulier let let user set the periode of each module with hours and minutes then let user set the price of one hour for each module and make it calculate the total price automatically according to the periode of that module 
after the user select the modules let user select the teacher for each module with let the user search about the teacher if existing and make possibility of create the teacher on the same interface with display for user the same interface of create new teacher from the teachers interface
and make possibility of user create teacher passager only with name and phone number and descripiton 
after the user select the teachers let him set the pourcentage that will get this teacher from the total price of that module 
make option of user set if the student payed or not with possibility of edit how much the student payed to make it save as debt 
if the user set the student payed then let user set if the teacher get payed or no and if he did not payed make sure to make it display alert on the main page and on the dashboard 
make the main page of this new interface of particulier display all the the programed seances and make it dispaly with filtering and possibility of search with student or with teacher and make it display the alerts then make it dispaly them on cards with button actions of edit and delete and view details for see all the small details about this seance and make button action for pay debt of student for this seance and button action for make the teacher of this seance payed and make button action for starting this seance and mark it done as the student studied and the seance competed and make button action for make the seance canceled and make sure to make button action for change the date of this seance to another date 
make sure to make the main page display alerts if the seance is soon or retard and make it dispaly this alerts on the dahsbaord also 


apply this updates then give me the full sql code that i have torun for this new updates and push all updates to repo with merge code directly without pull request 
