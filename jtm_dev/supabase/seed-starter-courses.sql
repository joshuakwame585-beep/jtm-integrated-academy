-- Optional starter catalogue. Run once AFTER schema.sql.
-- Inserts three free starter courses and three premium draft placeholders.
do $$
declare c_computers uuid; c_literacy uuid; c_cyber uuid; c_web uuid; c_python uuid; c_design uuid;
declare m_computers uuid; m_literacy uuid; m_cyber uuid;
begin
  select id into c_computers from public.courses where title='Introduction to Computers' limit 1;
  if c_computers is null then insert into public.courses(title,description,access,level,category,price,published) values('Introduction to Computers','Understand computer parts, common devices, software and everyday computer use.','free','Beginner','Computer Basics',0,true) returning id into c_computers; end if;
  select id into c_literacy from public.courses where title='Digital Literacy Essentials' limit 1;
  if c_literacy is null then insert into public.courses(title,description,access,level,category,price,published) values('Digital Literacy Essentials','Use devices, the internet and digital information safely and effectively.','free','Beginner','Digital Foundations',0,true) returning id into c_literacy; end if;
  select id into c_cyber from public.courses where title='Introduction to Cybersecurity' limit 1;
  if c_cyber is null then insert into public.courses(title,description,access,level,category,price,published) values('Introduction to Cybersecurity','Explore online safety, common cyber threats, passwords and responsible digital habits.','free','Beginner','Cyber Awareness',0,true) returning id into c_cyber; end if;
  select id into c_web from public.courses where title='Build Your First Website' limit 1;
  if c_web is null then insert into public.courses(title,description,access,level,category,price,published) values('Build Your First Website','Learn the foundations of HTML, CSS and JavaScript by creating a simple web page.','premium','Beginner','Web Development',100,false) returning id into c_web; end if;
  select id into c_python from public.courses where title='Python Programming Basics' limit 1;
  if c_python is null then insert into public.courses(title,description,access,level,category,price,published) values('Python Programming Basics','Get introduced to variables, data types, conditions, loops and small practice projects.','premium','Beginner','Programming',120,false) returning id into c_python; end if;
  select id into c_design from public.courses where title='Graphic Design Fundamentals' limit 1;
  if c_design is null then insert into public.courses(title,description,access,level,category,price,published) values('Graphic Design Fundamentals','Learn visual communication, layout, colour and the basics of creating digital designs.','premium','Beginner','Creative Digital Skills',90,false) returning id into c_design; end if;

  if not exists(select 1 from public.modules where course_id=c_computers) then
    insert into public.modules(course_id,title,position) values(c_computers,'Getting started with computers',1) returning id into m_computers;
    insert into public.lessons(module_id,title,body,position,duration) values
    (m_computers,'What is a computer?','A computer is an electronic device that accepts data, processes it according to instructions, stores information and produces results. Computers support learning, communication, creativity and many everyday tasks.',1,'8 min'),
    (m_computers,'Common types of computers','Desktop computers, laptops, tablets and smartphones are common computing devices. Each type has features suited to different activities.',2,'7 min'),
    (m_computers,'Hardware and software','Hardware refers to the physical parts of a computer. Software is the set of programs and instructions that tell hardware what to do.',3,'10 min');
    insert into public.quizzes(course_id,question,options,correct_index) values(c_computers,'Which one is computer hardware?','["Keyboard","Web browser","Operating system","Word processor"]'::jsonb,0);
  end if;
  if not exists(select 1 from public.modules where course_id=c_literacy) then
    insert into public.modules(course_id,title,position) values(c_literacy,'Digital foundations',1) returning id into m_literacy;
    insert into public.lessons(module_id,title,body,position,duration) values
    (m_literacy,'What is digital literacy?','Digital literacy is the ability to use digital devices, networks and information services safely, effectively and thoughtfully.',1,'8 min'),
    (m_literacy,'Responsible online behaviour','Think before sharing information, check sources, respect other people and protect private account details.',2,'9 min');
    insert into public.quizzes(course_id,question,options,correct_index) values(c_literacy,'Which is a good digital safety habit?','["Share passwords","Use strong unique passwords","Open every attachment","Ignore updates"]'::jsonb,1);
  end if;
  if not exists(select 1 from public.modules where course_id=c_cyber) then
    insert into public.modules(course_id,title,position) values(c_cyber,'Cybersecurity basics',1) returning id into m_cyber;
    insert into public.lessons(module_id,title,body,position,duration) values
    (m_cyber,'What is cybersecurity?','Cybersecurity is the practice of protecting computers, networks, systems and information from attacks, damage and unauthorised access.',1,'9 min'),
    (m_cyber,'Threats and vulnerabilities','A threat is something that could cause harm. A vulnerability is a weakness that could be exploited. Understanding both helps people reduce risk.',2,'9 min');
    insert into public.quizzes(course_id,question,options,correct_index) values(c_cyber,'What is a vulnerability?','["A system weakness","A strong password","A backup copy","A security policy"]'::jsonb,0);
  end if;
end $$;
