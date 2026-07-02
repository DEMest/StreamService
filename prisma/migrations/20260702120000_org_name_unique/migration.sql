-- Organization.name становится уникальным: теперь это отображаемое имя,
-- которое сама орга может менять из дашборда (с проверкой на занятость).
CREATE UNIQUE INDEX "Organization_name_key" ON "Organization"("name");
