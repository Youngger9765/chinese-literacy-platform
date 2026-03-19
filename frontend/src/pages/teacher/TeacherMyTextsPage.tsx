/**
 * TeacherMyTextsPage — standalone page for teacher's custom texts.
 * Route: /teacher/my-texts
 * Lifted from ClassroomDetail tab to sidebar level (#550).
 */
import React from 'react';
import MyTextsTab from './MyTextsTab';

const TeacherMyTextsPage: React.FC = () => {
  return (
    <div className="flex-1 overflow-y-auto p-6 sm:p-8">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-xl font-bold text-gray-900 mb-6">我的課文</h1>
        <MyTextsTab />
      </div>
    </div>
  );
};

export default TeacherMyTextsPage;
